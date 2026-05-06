/**
 * Daily Monitoring Job
 * Runs screening on all active clients + related parties
 * and checks for trade register / data staleness changes.
 * Architecture is country-agnostic: register check stub returns 
 * change details; replace the stub with real country-specific API per integration.
 * 
 * This function is intended to be called by a scheduled automation.
 * It acts under service role — no user auth needed.
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

// ── Screening lists (same data as client-side stub; kept server-side for security) ──
const PEP_NAMES = [
  { name: 'Former Government Minister', source: 'PEP_List', detail: 'Former Minister of Finance, resigned 2019.' },
  { name: 'Municipal Council Member',   source: 'PEP_List', detail: 'Active local government official.' },
];
const SANCTIONS = [
  { name: 'OFAC SDN List Match',        source: 'Sanctions_EU', detail: 'OFAC SDN list match.' },
  { name: 'EU Consolidated Sanctions',  source: 'Sanctions_UN', detail: 'EU consolidated sanctions list.' },
];
const ADVERSE = [
  { name: 'Financial Regulator Investigation', source: 'Adverse_Media', detail: 'Subject of regulator investigation.' },
  { name: 'Money Laundering Allegations',      source: 'Adverse_Media', detail: 'Multiple adverse media references.' },
];

function seededRand(seed, offset) {
  let x = Math.sin(seed + offset) * 10000;
  return x - Math.floor(x);
}

function screenEntity(name) {
  const seed = name.split('').reduce((a, c) => a + c.charCodeAt(0), 0);
  const hits = [];
  // Use a lower threshold for monitoring (existing clients — flag new hits only)
  if (seededRand(seed, 1) < 0.08) {
    hits.push({ ...PEP_NAMES[Math.floor(seededRand(seed, 2) * PEP_NAMES.length)], confidence: Math.round(40 + seededRand(seed, 3) * 50) });
  }
  if (seededRand(seed, 6) < 0.05) {
    hits.push({ ...SANCTIONS[Math.floor(seededRand(seed, 7) * SANCTIONS.length)], confidence: Math.round(55 + seededRand(seed, 8) * 40) });
  }
  if (seededRand(seed, 9) < 0.06) {
    hits.push({ ...ADVERSE[Math.floor(seededRand(seed, 10) * ADVERSE.length)], confidence: Math.round(45 + seededRand(seed, 11) * 45) });
  }
  return hits;
}

/**
 * Country-agnostic register change stub.
 * Replace this function body with real KvK / Companies House / etc. API calls.
 * Returns an array of changes or empty array.
 */
async function checkRegisterChanges(entity) {
  // Stub: ~5% chance of a simulated register change
  const seed = entity.full_name.split('').reduce((a, c) => a + c.charCodeAt(0), 0);
  const r = seededRand(seed, 42);
  if (r < 0.05) {
    const changes = ['Directorship change detected', 'New shareholder registered (>25% ownership)', 'Registered address updated', 'Company status change'];
    return [{ field: changes[Math.floor(r * 20) % changes.length], detected_at: new Date().toISOString() }];
  }
  return [];
}

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);

  let processed = 0, screeningAlerts = 0, registerAlerts = 0, errors = 0;

  // Fetch all active clients across all tenants
  const clients = await base44.asServiceRole.entities.Client.filter({ status: 'Active' }, null, 500);

  for (const client of (clients || [])) {
    try {
      // 1. Screening check
      const hits = screenEntity(client.full_name);
      for (const hit of hits) {
        // De-duplicate: skip if an identical open alert already exists
        const existing = await base44.asServiceRole.entities.MonitoringAlert.filter({
          client_id: client.id,
          alert_type: 'Screening_Hit',
          source: hit.source,
          status: 'New',
        }, null, 1);
        if (existing?.length > 0) continue;

        await base44.asServiceRole.entities.MonitoringAlert.create({
          tenant_id: client.tenant_id,
          client_id: client.id,
          entity_name: client.full_name,
          entity_type: 'Client',
          alert_type: 'Screening_Hit',
          source: hit.source,
          details: { hit_name: hit.name, detail: hit.detail, confidence: hit.confidence },
          status: 'New',
          is_monitoring_alert: true,
        });
        screeningAlerts++;
      }

      // 2. Register change check (ORG clients only)
      if (client.client_type === 'ORG') {
        const changes = await checkRegisterChanges(client);
        for (const change of changes) {
          const existing = await base44.asServiceRole.entities.MonitoringAlert.filter({
            client_id: client.id,
            alert_type: 'Register_Change',
            status: 'New',
          }, null, 1);
          if (existing?.length > 0) continue;

          await base44.asServiceRole.entities.MonitoringAlert.create({
            tenant_id: client.tenant_id,
            client_id: client.id,
            entity_name: client.full_name,
            entity_type: 'Client',
            alert_type: 'Register_Change',
            source: `Trade Register (${client.registered_country || 'Unknown'})`,
            details: change,
            status: 'New',
            is_monitoring_alert: true,
          });
          registerAlerts++;
        }
      }

      // 3. Also screen related parties
      const links = await base44.asServiceRole.entities.ClientRelatedPartyLink.filter({ client_id: client.id });
      for (const link of (links || [])) {
        const rps = await base44.asServiceRole.entities.RelatedParty.filter({ id: link.related_party_id });
        const rp = rps?.[0];
        if (!rp) continue;
        const rpHits = screenEntity(rp.full_name);
        for (const hit of rpHits) {
          const existing = await base44.asServiceRole.entities.MonitoringAlert.filter({
            related_party_id: rp.id,
            alert_type: 'Screening_Hit',
            source: hit.source,
            status: 'New',
          }, null, 1);
          if (existing?.length > 0) continue;

          await base44.asServiceRole.entities.MonitoringAlert.create({
            tenant_id: client.tenant_id,
            client_id: client.id,
            related_party_id: rp.id,
            entity_name: rp.full_name,
            entity_type: 'Related_Party',
            alert_type: 'Screening_Hit',
            source: hit.source,
            details: { hit_name: hit.name, detail: hit.detail, confidence: hit.confidence },
            status: 'New',
            is_monitoring_alert: true,
          });
          screeningAlerts++;
        }
      }

      processed++;
    } catch (err) {
      console.error(`Error processing client ${client.id}:`, err.message);
      errors++;
    }
  }

  console.log(`Daily monitoring complete: ${processed} clients, ${screeningAlerts} screening alerts, ${registerAlerts} register alerts, ${errors} errors`);

  return Response.json({
    status: 'ok',
    processed,
    screening_alerts_created: screeningAlerts,
    register_alerts_created: registerAlerts,
    errors,
  });
});