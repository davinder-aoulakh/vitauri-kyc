// decideScreeningAlert — the Screening page decides one thing: is it this person? (phase 5). Requires tm_core.
// Auth: signed-in user who may run cases (ACCOUNT_ROLES or Director); tenant from the user.
//   { alert_id, decision: 'not_this_person', rationale } -> alert Dismissed with the rationale
//   { alert_id, decision: 'true_match', rationale }      -> ScreeningHit Confirmed_Match (found or created), alert
//       Confirmed_Match, and a change of circumstances (EdrTrigger) is proposed. No review is opened here.
// Reads and writes Vitauri data only: no Didit call (the hit status in Didit keeps its own control).
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.52';
import { isTmEnabled } from '../../shared/tmGuards.js';
import { authenticate, errorResponse, httpError, loadTenant, asList, ACCOUNT_ROLES } from '../../shared/tmAuth.js';
import { writeAudit } from '../../shared/tmAudit.js';
import { proposeTriggers } from '../../shared/edrTriggers.js';
import { isScreeningAlert, isSanctionsAlert, hitSourceFor } from '../../shared/cocResponse.js';
import { caseGroupingSettings } from '../../shared/tmCaseGrouping.js';
import { autoCaseForAlert } from '../../shared/tmAutoCase.js';
import { safeAlertRef } from '../../shared/tmRefs.js';

const OPEN = ['New', 'Under_Review'];
const clip = (v, n = 2000) => String(v ?? '').trim().slice(0, n);

export default async function (req) {
  try {
    const base44 = createClientFromRequest(req);
    const body = await req.json();
    const auth = await authenticate(base44, req, body, { roles: [...ACCOUNT_ROLES, 'Director'], allowApiKey: false });
    const tenantId = auth.tenantId;
    const tenant = await loadTenant(base44, tenantId);
    if (!isTmEnabled(tenant, 'tm_core')) throw httpError(403, 'Feature tm_core is not enabled');
    const E = base44.asServiceRole.entities;

    if (!body.alert_id) throw httpError(400, 'alert_id is required');
    if (!['true_match', 'not_this_person'].includes(body.decision)) throw httpError(400, "decision must be 'true_match' or 'not_this_person'");
    const rationale = clip(body.rationale);
    if (rationale.length < 10) throw httpError(400, 'A rationale of at least 10 characters is required');

    const alert = asList(await E.MonitoringAlert.filter({ tenant_id: tenantId, id: body.alert_id }, undefined, 1))[0];
    if (!alert || alert.tenant_id !== tenantId) throw httpError(404, 'Alert not found');
    if (!isScreeningAlert(alert)) throw httpError(400, 'This alert is not a screening alert');
    if (!OPEN.includes(alert.status)) throw httpError(409, `This alert is already ${String(alert.status).replace(/_/g, ' ')}`);
    const nowIso = new Date().toISOString();
    const details = alert.details && typeof alert.details === 'object' ? alert.details : {};
    const decisionMeta = { decision: body.decision, decided_by: auth.actorName, decided_at: nowIso };

    if (body.decision === 'not_this_person') {
      await E.MonitoringAlert.update(alert.id, { status: 'Dismissed', dismissed_justification: rationale, details: { ...details, ...decisionMeta } });
      await writeAudit(base44, auth, {
        tenantId, clientId: alert.client_id, eventType: 'screening_alert_not_this_person',
        before: { status: alert.status }, after: { status: 'Dismissed', monitoring_alert_id: alert.id },
        notes: `Screening alert for ${alert.entity_name || 'the customer'} decided "Not this person" by ${auth.actorName}: ${rationale}`,
      });
      return Response.json({ ok: true, status: 'Dismissed' });
    }

    // ── True match ──
    const client = asList(await E.Client.filter({ tenant_id: tenantId, id: alert.client_id }, undefined, 1))[0];
    if (!client) throw httpError(404, 'Client not found');
    let caseId = alert.case_id || null;
    if (!caseId) caseId = asList(await E.KycCase.filter({ tenant_id: tenantId, client_id: client.id }, '-created_date', 1))[0]?.id || null;
    if (!caseId) throw httpError(409, 'This customer has no review yet; a confirmed match needs a review to attach to');

    // The screening hit record: the one this alert already points to, else a new one.
    let hit = null;
    if (details.screening_hit_id) hit = asList(await E.ScreeningHit.filter({ tenant_id: tenantId, id: details.screening_hit_id }, undefined, 1))[0] || null;
    if (!hit) {
      const mine = asList(await E.ScreeningHit.filter({ tenant_id: tenantId, client_id: client.id, is_monitoring_alert: true }, '-created_date', 200));
      hit = mine.find((h) => h.hit_details?.monitoring_alert_id === alert.id) || null;
    }
    const confirmed = { status: 'Confirmed_Match', analyst_decision: 'Confirmed', analyst_justification: rationale, resolved_by_user_id: auth.actorUserId };
    if (hit) {
      await E.ScreeningHit.update(hit.id, confirmed);
    } else {
      hit = await E.ScreeningHit.create({
        tenant_id: tenantId, client_id: client.id, case_id: caseId,
        ...(alert.related_party_id ? { related_party_id: alert.related_party_id } : {}),
        entity_name: alert.entity_name || client.full_name, entity_type: alert.entity_type || 'Client',
        source: hitSourceFor(alert),
        hit_name: clip(details.hit_name || details.matched_name || details.name || details.caption || alert.entity_name || client.full_name, 200),
        hit_details: { ...details, monitoring_alert_id: alert.id, alert_type: alert.alert_type, alert_source: alert.source || null },
        ...(Number.isFinite(Number(details.match_score)) ? { confidence_score: Number(details.match_score) } : {}),
        is_monitoring_alert: true, ...confirmed,
      });
    }
    await E.MonitoringAlert.update(alert.id, { status: 'Confirmed_Match', dismissed_justification: rationale, details: { ...details, ...decisionMeta, screening_hit_id: hit.id } });
    await writeAudit(base44, auth, {
      tenantId, clientId: client.id, eventType: 'screening_alert_true_match',
      before: { status: alert.status }, after: { status: 'Confirmed_Match', monitoring_alert_id: alert.id, screening_hit_id: hit.id },
      notes: `Screening alert for ${alert.entity_name || client.full_name} decided "True match" by ${auth.actorName}: ${rationale}`,
    });

    // Change of circumstances. Same key as the nightly scan (edrTriggers.screeningFindings), so the event appears once.
    const source = String(hit.source || hitSourceFor(alert)).replace(/_/g, ' ');
    const created = await proposeTriggers(E, {
      tenantId, client, sourceRef: `monitoring_alert:${alert.id}`, actor: auth,
      findings: [{
        type: 'screening_hit', key: `screening_hit:${hit.id}`, before: {}, source_label: 'Screening',
        after: { screening_hit_id: hit.id, source: hit.source || null, hit_name: hit.hit_name || null, monitoring_alert_id: alert.id, entity_name: alert.entity_name || null },
        summary: `Confirmed ${source} match${hit.hit_name ? `: ${hit.hit_name}` : ''}`,
      }],
    });
    let triggerId = created[0]?.id || null;
    if (!triggerId) triggerId = asList(await E.EdrTrigger.filter({ tenant_id: tenantId, dedupe_key: `${client.id}:screening_hit:${hit.id}` }, undefined, 1))[0]?.id || null;

    // Tenant setting (phase 4): a confirmed sanctions hit starts an investigation straight away.
    let investigation = null;
    if (isSanctionsAlert(alert) && caseGroupingSettings(tenant).auto_case_sanctions) {
      try {
        const dedupeKey = `${client.id}:sanctions_hit:${hit.id}`;
        let tmAlert = asList(await E.TmAlert.filter({ tenant_id: tenantId, dedupe_key: dedupeKey }, undefined, 1))[0];
        if (!tmAlert) {
          tmAlert = await E.TmAlert.create({
            ref: await safeAlertRef(E, tenantId), tenant_id: tenantId, client_id: client.id, source: 'manual', status: 'new',
            title: `Confirmed sanctions match: ${hit.hit_name || alert.entity_name || client.full_name}`, score: 90, priority: 90,
            indicator_type: 'subjective', ai_reasons: [`Sanctions match confirmed on the Screening page by ${auth.actorName}.`],
            transaction_ids: [], received_at: nowIso, discovered_at: nowIso, dedupe_key: dedupeKey,
          });
          await writeAudit(base44, auth, {
            tenantId, clientId: client.id, eventType: 'tm_alert_created',
            before: {}, after: { tm_alert_id: tmAlert.id, dedupe_key: dedupeKey, source: 'manual', screening_hit_id: hit.id },
            notes: 'Alert created from a confirmed sanctions match (tenant setting: start an investigation for confirmed sanctions hits).',
          });
        }
        investigation = await autoCaseForAlert(base44, tenant, { ...tmAlert, sanctions_confirmed: true });
      } catch (e) {
        console.warn('decideScreeningAlert: sanctions investigation failed', e?.message || e);
      }
    }
    return Response.json({ ok: true, status: 'Confirmed_Match', screening_hit_id: hit.id, edr_trigger_id: triggerId, change_event_created: created.length > 0, investigation });
  } catch (error) {
    console.error('decideScreeningAlert error:', error?.message);
    return errorResponse(error);
  }
}
