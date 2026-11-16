// Starts (or extends) an investigation without a user, for alerts a tenant wants investigated straight away
// (tenant setting: objective indicators). Same grouping rule as the Escalate button. Never throws to its caller.
import { asList } from './tmAuth.js';
import { caseGroupingSettings, autoCaseReason, pickCase, groupingKeyFor } from './tmCaseGrouping.js';
import { nextCaseRef, clockPatch } from './tmCaseCommon.js';
import { refreshAmlHold } from './tippingOff.js';

const OPEN_CASE = ['open', 'investigating', 'pending_co'];
const ACTOR = { actor_type: 'System', actor_name: 'Vitauri (automatic investigation)' };

export async function autoCaseForAlert(base44, tenant, alert) {
  try {
    const cfg = caseGroupingSettings(tenant);
    const reason = autoCaseReason(alert, cfg);
    if (!reason || alert.tm_case_id) return null;
    const E = base44.asServiceRole.entities;
    const tenantId = tenant.id;
    const nowIso = new Date().toISOString();
    const open = asList(await E.TmCase.filter({ tenant_id: tenantId, primary_client_id: alert.client_id, status: { $in: OPEN_CASE } }, 'created_date', 50));
    const target = pickCase(open.filter((c) => ['open', 'investigating'].includes(c.status)), alert, cfg.case_grouping);
    let caseId; let caseRef; let created = false;
    if (target) {
      await E.TmCase.update(target.id, {
        alert_ids: [...new Set([...(target.alert_ids || []), alert.id])],
        timeline: [...(target.timeline || []), { at: nowIso, kind: 'alerts_added', text: `Alert ${alert.ref || alert.id} added automatically (${reason}).` }],
      });
      caseId = target.id; caseRef = target.case_ref;
    } else {
      const client = asList(await E.Client.filter({ tenant_id: tenantId, id: alert.client_id }))[0];
      const base = { created_date: nowIso, escalated_to_co_at: null, co_decided_at: null };
      const rec = await E.TmCase.create({
        tenant_id: tenantId, case_ref: await nextCaseRef(E, tenantId), primary_client_id: alert.client_id, client_ids: [alert.client_id],
        alert_ids: [alert.id], title: alert.title || 'TM investigation', status: 'open', evidence: [],
        ...(client?.assigned_analyst_id ? { assigned_to_user_id: client.assigned_analyst_id } : {}),
        grouping_key: groupingKeyFor(alert, cfg.case_grouping),
        ...(await clockPatch({ E, tenant, tenantId }, base, alert).catch(() => ({}))),
        timeline: [{ at: nowIso, kind: 'created', text: `Investigation started automatically from alert ${alert.ref || alert.id} (${reason}).` }],
      });
      caseId = rec.id; caseRef = rec.case_ref; created = true;
    }
    await E.TmAlert.update(alert.id, { tm_case_id: caseId, status: 'in_review' });
    await refreshAmlHold(base44, tenantId, alert.client_id);
    await E.AuditEvent.create({
      tenant_id: tenantId, client_id: alert.client_id, ...ACTOR, event_type: created ? 'tm_case_created' : 'tm_alert_added_to_case',
      before_state: { tm_case_id: null }, after_state: { tm_case_id: caseId, case_ref: caseRef, alert_id: alert.id, automatic: true, reason },
      notes: created ? `Investigation ${caseRef} started automatically from alert ${alert.ref || alert.id} (${reason}).` : `Alert ${alert.ref || alert.id} added automatically to investigation ${caseRef} (${reason}).`,
    });
    return { tm_case_id: caseId, case_ref: caseRef, created };
  } catch (e) {
    console.warn('autoCaseForAlert failed', e?.message || e);
    return null;
  }
}
