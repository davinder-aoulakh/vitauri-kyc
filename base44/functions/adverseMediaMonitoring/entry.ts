/**
 * Adverse Media Monitoring — Daily automated job
 *
 * For each active client (and their related parties):
 *  1. Uses AI + internet search to find recent negative news articles
 *  2. Creates ScreeningHit records for new adverse media findings
 *  3. Updates the most recent open case's step_3_status to 'flagged'
 *  4. Creates a high-priority Notification for the assigned analyst
 *  5. Creates a MonitoringAlert for the monitoring dashboard
 *
 * Designed to be called by a daily scheduled automation (no user auth needed).
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

const ADVERSE_MEDIA_PROMPT = (entityName, entityType, context) => `
You are a compliance analyst performing adverse media screening for AML/KYC purposes.

Search for recent adverse media (news articles, regulatory actions, legal proceedings, enforcement actions) 
about this entity within the last 90 days:

Entity Name: ${entityName}
Entity Type: ${entityType}
Additional Context: ${context || 'N/A'}

Return ONLY findings that are genuinely concerning from a financial crime / AML / compliance perspective. 
Do NOT return false positives or benign news. Be conservative — only flag real adverse content.

For each adverse finding, provide:
- headline: Short headline of the adverse news
- source_type: One of: Regulatory_Action, Legal_Proceedings, Financial_Crime, Fraud_Allegations, Sanctions_Related, Corruption, Adverse_General
- publication_date: Approximate date (YYYY-MM-DD or "recent")
- summary: 1-2 sentence summary of why this is concerning
- severity: "High" | "Medium" | "Low"
- confidence: 0-100 (how confident are you this is a real, relevant adverse finding)

If no genuine adverse media found, return an empty hits array.
`;

function buildContext(entity, entityType) {
  if (entityType === 'Client') {
    const parts = [];
    if (entity.client_type === 'NP') {
      if (entity.nationality) parts.push(`Nationality: ${entity.nationality}`);
      if (entity.country_of_residence) parts.push(`Country: ${entity.country_of_residence}`);
    } else {
      if (entity.registered_country) parts.push(`Jurisdiction: ${entity.registered_country}`);
      if (entity.sector) parts.push(`Sector: ${entity.sector}`);
      if (entity.registration_number) parts.push(`Reg: ${entity.registration_number}`);
    }
    return parts.join(', ');
  } else {
    const parts = [];
    if (entity.nationality) parts.push(`Nationality: ${entity.nationality}`);
    if (entity.registered_country) parts.push(`Country: ${entity.registered_country}`);
    return parts.join(', ');
  }
}

async function runAdverseMediaSearch(base44, entityName, entityType, context) {
  const result = await base44.asServiceRole.integrations.Core.InvokeLLM({
    prompt: ADVERSE_MEDIA_PROMPT(entityName, entityType, context),
    add_context_from_internet: true,
    model: 'gemini_3_flash',
    response_json_schema: {
      type: 'object',
      properties: {
        hits: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              headline:         { type: 'string' },
              source_type:      { type: 'string' },
              publication_date: { type: 'string' },
              summary:          { type: 'string' },
              severity:         { type: 'string' },
              confidence:       { type: 'number' },
            },
          },
        },
        search_summary: { type: 'string' },
      },
    },
  });
  return result?.hits || [];
}

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);

  let processed = 0, hitsCreated = 0, notificationsCreated = 0, casesFlagged = 0, errors = 0;
  const runDate = new Date().toISOString().split('T')[0];

  // Fetch all active clients
  const clients = await base44.asServiceRole.entities.Client.filter({ status: 'Active' }, null, 200);

  for (const client of (clients || [])) {
    try {
      const context = buildContext(client, 'Client');
      const mediaHits = await runAdverseMediaSearch(base44, client.full_name, client.client_type === 'ORG' ? 'Organisation' : 'Natural Person', context);

      // Filter to meaningful hits only (confidence >= 55)
      const significantHits = mediaHits.filter(h => (h.confidence || 0) >= 55);

      for (const hit of significantHits) {
        // De-duplicate: skip if identical hit exists in last 7 days
        const existing = await base44.asServiceRole.entities.ScreeningHit.filter({
          client_id: client.id,
          source: 'Adverse_Media',
          hit_name: hit.headline,
          status: 'New',
        }, null, 1);
        if (existing?.length > 0) continue;

        // 1. Find the most recent open/active case for this client
        const activeCases = await base44.asServiceRole.entities.KycCase.filter(
          { client_id: client.id },
          '-created_date',
          5
        );
        const openCase = (activeCases || []).find(c =>
          !['Approved', 'Rejected', 'Closed'].includes(c.status)
        ) || activeCases?.[0];

        // 2. Create ScreeningHit record
        const screeningHit = await base44.asServiceRole.entities.ScreeningHit.create({
          tenant_id:          client.tenant_id,
          client_id:          client.id,
          case_id:            openCase?.id || '',
          entity_name:        client.full_name,
          entity_type:        'Client',
          source:             'Adverse_Media',
          hit_name:           hit.headline,
          hit_details: {
            source_type:      hit.source_type,
            publication_date: hit.publication_date,
            summary:          hit.summary,
            severity:         hit.severity,
            detected_by:      'automated_monitoring',
            run_date:         runDate,
          },
          confidence_score:   hit.confidence,
          status:             'New',
          ai_recommendation:  hit.severity === 'High' ? 'Confirmed_Match' : 'Possible_Match',
          ai_rationale:       hit.summary,
          is_monitoring_alert: true,
        });
        hitsCreated++;

        // 3. Flag the open case's screening step if we have one
        if (openCase?.id) {
          await base44.asServiceRole.entities.KycCase.update(openCase.id, {
            step_3_status: 'flagged',
          });

          // Audit trail
          await base44.asServiceRole.entities.AuditEvent.create({
            tenant_id:    client.tenant_id,
            client_id:    client.id,
            case_id:      openCase.id,
            actor_type:   'System',
            actor_name:   'Adverse Media Monitor',
            event_type:   'adverse_media_hit_detected',
            notes:        `Automated adverse media monitoring flagged: "${hit.headline}" (confidence: ${hit.confidence}%, severity: ${hit.severity})`,
            after_state: {
              hit_name:    hit.headline,
              severity:    hit.severity,
              confidence:  hit.confidence,
              source_type: hit.source_type,
            },
          });
          casesFlagged++;
        }

        // 4. Create MonitoringAlert for the dashboard
        await base44.asServiceRole.entities.MonitoringAlert.create({
          tenant_id:       client.tenant_id,
          client_id:       client.id,
          entity_name:     client.full_name,
          entity_type:     'Client',
          alert_type:      'Screening_Hit',
          source:          'Adverse_Media',
          details: {
            headline:        hit.headline,
            source_type:     hit.source_type,
            publication_date:hit.publication_date,
            summary:         hit.summary,
            severity:        hit.severity,
            screening_hit_id:screeningHit?.id,
          },
          ai_impact_summary: `${hit.severity} severity adverse media: ${hit.summary}`,
          status:           'New',
          assigned_analyst_id: openCase?.assigned_analyst_id || client.assigned_analyst_id,
          edr_case_id:      openCase?.id,
        });

        // 5. Notify the assigned analyst
        const analystId = openCase?.assigned_analyst_id || client.assigned_analyst_id;
        if (analystId) {
          const caseRef = openCase ? ` on case ${openCase.case_type?.replace(/_/g, ' ')}` : '';
          await base44.asServiceRole.entities.Notification.create({
            tenant_id:       client.tenant_id,
            user_id:         analystId,
            type:            'monitoring_alert',
            title:           `⚠ Adverse Media Hit — ${client.full_name}`,
            body:            `${hit.severity} severity adverse media detected${caseRef}: "${hit.headline}". Confidence: ${hit.confidence}%. Immediate review required.`,
            link_client_id:  client.id,
            link_case_id:    openCase?.id || '',
            is_read:         false,
          });
          notificationsCreated++;
        }
      }

      // 6. Screen related parties too
      const links = await base44.asServiceRole.entities.ClientRelatedPartyLink.filter({ client_id: client.id });
      for (const link of (links || [])) {
        const rps = await base44.asServiceRole.entities.RelatedParty.filter({ id: link.related_party_id });
        const rp = rps?.[0];
        if (!rp) continue;

        const rpContext = buildContext(rp, 'RelatedParty');
        const rpHits = await runAdverseMediaSearch(
          base44, rp.full_name,
          rp.party_type === 'ORG' ? 'Organisation' : 'Natural Person',
          rpContext
        );

        for (const hit of rpHits.filter(h => (h.confidence || 0) >= 55)) {
          const existing = await base44.asServiceRole.entities.ScreeningHit.filter({
            related_party_id: rp.id,
            source: 'Adverse_Media',
            hit_name: hit.headline,
            status: 'New',
          }, null, 1);
          if (existing?.length > 0) continue;

          const activeCases = await base44.asServiceRole.entities.KycCase.filter({ client_id: client.id }, '-created_date', 3);
          const openCase = (activeCases || []).find(c => !['Approved', 'Rejected', 'Closed'].includes(c.status)) || activeCases?.[0];

          await base44.asServiceRole.entities.ScreeningHit.create({
            tenant_id:        client.tenant_id,
            client_id:        client.id,
            related_party_id: rp.id,
            case_id:          openCase?.id || '',
            entity_name:      rp.full_name,
            entity_type:      'Related_Party',
            source:           'Adverse_Media',
            hit_name:         hit.headline,
            hit_details: {
              source_type:    hit.source_type,
              publication_date:hit.publication_date,
              summary:        hit.summary,
              severity:       hit.severity,
              detected_by:    'automated_monitoring',
              run_date:       runDate,
              related_party:  true,
            },
            confidence_score: hit.confidence,
            status:           'New',
            ai_recommendation:hit.severity === 'High' ? 'Confirmed_Match' : 'Possible_Match',
            ai_rationale:     hit.summary,
            is_monitoring_alert: true,
          });
          hitsCreated++;

          const analystId = openCase?.assigned_analyst_id || client.assigned_analyst_id;
          if (analystId) {
            await base44.asServiceRole.entities.Notification.create({
              tenant_id:      client.tenant_id,
              user_id:        analystId,
              type:           'monitoring_alert',
              title:          `⚠ Adverse Media — Related Party: ${rp.full_name}`,
              body:           `${hit.severity} severity adverse media detected for related party "${rp.full_name}" linked to client "${client.full_name}": "${hit.headline}". Confidence: ${hit.confidence}%.`,
              link_client_id: client.id,
              link_case_id:   openCase?.id || '',
              is_read:        false,
            });
            notificationsCreated++;
          }
        }
      }

      processed++;
      // Small delay between clients to avoid rate limiting
      await new Promise(r => setTimeout(r, 300));
    } catch (err) {
      console.error(`Error processing client ${client.id} (${client.full_name}):`, err.message);
      errors++;
    }
  }

  const summary = `Adverse media monitoring complete: ${processed} clients screened, ${hitsCreated} hits created, ${casesFlagged} cases flagged, ${notificationsCreated} analyst notifications sent, ${errors} errors.`;
  console.log(summary);

  return Response.json({
    status: 'ok',
    run_date: runDate,
    clients_processed:       processed,
    adverse_hits_created:    hitsCreated,
    cases_flagged:           casesFlagged,
    notifications_sent:      notificationsCreated,
    errors,
    summary,
  });
});