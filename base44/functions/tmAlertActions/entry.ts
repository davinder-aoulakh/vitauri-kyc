// tmAlertActions — audited alert workflow actions: assign_to_me, create_case, add_to_case, escalate.
// escalate = add the alert to the open investigation it belongs to (tenant setting case_grouping), or start one.
// Auth: signed-in user with tmWorkCase; tenant from the user. Requires tm_core.
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.52';
import { isTmEnabled } from '../../shared/tmGuards.js';
import { authenticate, errorResponse, httpError, loadTenant, asList, WORK_ROLES } from '../../shared/tmAuth.js';
import { writeAudit } from '../../shared/tmAudit.js';
import { caseGroupingSettings, pickCase, groupingKeyFor, aiFollowed } from '../../shared/tmCaseGrouping.js';
import { createCase, addAlerts } from '../../shared/tmCaseCore.js';

const OPEN_ALERT = ['new', 'triaged', 'in_review'];
const OPEN_CASE = ['open', 'investigating', 'pending_co'];

export default async function (req) {
  try {
    const base44 = createClientFromRequest(req);
    const body = await req.json();
    const auth = await authenticate(base44, req, body, { roles: WORK_ROLES, allowApiKey: false });
    const tenantId = auth.tenantId;
    const E = base44.asServiceRole.entities;
    const tenant = await loadTenant(base44, tenantId);
    if (!isTmEnabled(tenant, 'tm_core')) throw httpError(403, 'Feature tm_core is not enabled');

    const alert = asList(await E.TmAlert.filter({ tenant_id: tenantId, id: body.alert_id }))[0];
    if (!alert) throw httpError(404, 'Alert not found');
    if (!OPEN_ALERT.includes(alert.status)) throw httpError(409, `Alert is ${alert.status}`);
    const audit = (eventType, before, after, notes) =>
      writeAudit(base44, auth, { tenantId, clientId: alert.client_id, eventType, before, after, notes });

    if (body.action === 'assign_to_me') {
      await E.TmAlert.update(alert.id, { assigned_to_user_id: auth.actorUserId, ...(alert.status === 'new' ? { status: 'in_review' } : {}) });
      await audit('tm_alert_assigned', { assigned_to_user_id: alert.assigned_to_user_id || null, status: alert.status },
        { assigned_to_user_id: auth.actorUserId, status: alert.status === 'new' ? 'in_review' : alert.status }, `Alert ${alert.id} assigned to ${auth.actorName}.`);
      return Response.json({ ok: true });
    }

    if (body.action === 'create_case') {
      if (alert.tm_case_id) throw httpError(409, 'Alert is already linked to a case');
      const year = new Date().getUTCFullYear();
      const n = (await E.TmCase.filter({ tenant_id: tenantId }, '-created_date', 1000).then(asList)).length + 1;
      const created = await E.TmCase.create({
        tenant_id: tenantId, case_ref: `CASE-${year}-${String(n).padStart(4, '0')}`, client_ids: [alert.client_id], primary_client_id: alert.client_id,
        alert_ids: [alert.id], title: alert.title || 'TM case', status: 'open', assigned_to_user_id: auth.actorUserId,
        timeline: [{ at: new Date().toISOString(), kind: 'created', text: `Case created from alert ${alert.id} by ${auth.actorName}.` }],
      });
      await E.TmAlert.update(alert.id, { tm_case_id: created.id, status: 'in_review', assigned_to_user_id: alert.assigned_to_user_id || auth.actorUserId });
      await audit('tm_case_created', { tm_case_id: null }, { tm_case_id: created.id, case_ref: created.case_ref }, `Case ${created.case_ref} created from alert ${alert.id}.`);
      return Response.json({ ok: true, tm_case_id: created.id, case_ref: created.case_ref });
    }

    if (body.action === 'add_to_case') {
      if (alert.tm_case_id) throw httpError(409, 'Alert is already linked to a case');
      const tmCase = asList(await E.TmCase.filter({ tenant_id: tenantId, id: body.tm_case_id }))[0];
      if (!tmCase) throw httpError(404, 'Case not found');
      if (!OPEN_CASE.includes(tmCase.status)) throw httpError(409, `Case is ${tmCase.status}`);
      const clientIds = [...new Set([...(tmCase.client_ids || []), alert.client_id])];
      await E.TmCase.update(tmCase.id, {
        alert_ids: [...new Set([...(tmCase.alert_ids || []), alert.id])], client_ids: clientIds,
        timeline: [...(tmCase.timeline || []), { at: new Date().toISOString(), kind: 'alert_added', text: `Alert ${alert.id} added by ${auth.actorName}.` }],
      });
      await E.TmAlert.update(alert.id, { tm_case_id: tmCase.id, status: 'in_review' });
      await audit('tm_alert_added_to_case', { tm_case_id: null }, { tm_case_id: tmCase.id, case_ref: tmCase.case_ref }, `Alert ${alert.id} added to case ${tmCase.case_ref}.`);
      return Response.json({ ok: true, tm_case_id: tmCase.id, case_ref: tmCase.case_ref });
    }

    if (body.action === 'escalate') {
      if (alert.tm_case_id) throw httpError(409, 'Alert is already linked to an investigation');
      const mode = caseGroupingSettings(tenant).case_grouping;
      const open = asList(await E.TmCase.filter({ tenant_id: tenantId, primary_client_id: alert.client_id, status: { $in: OPEN_CASE } }, 'created_date', 50));
      // An investigation already waiting for the Compliance Officer's decision is not extended: a new one is started.
      const target = pickCase(open.filter((c) => ['open', 'investigating'].includes(c.status)), alert, mode);
      const ctx = { base44, E, auth, tenantId, tenant };
      let out; let created = false;
      if (target) {
        await addAlerts(ctx, target, { alert_ids: [alert.id] });
        out = { tm_case_id: target.id, case_ref: target.case_ref };
      } else {
        out = await createCase(ctx, null, { alert_ids: [alert.id], title: alert.title });
        await E.TmCase.update(out.tm_case_id, { grouping_key: groupingKeyFor(alert, mode) });
        created = true;
      }
      const followed = aiFollowed(alert.ai_proposal, 'escalate');
      if (followed !== null) await E.TmAlert.update(alert.id, { ai_followed: followed });
      await audit('tm_alert_escalated', { tm_case_id: null, ai_proposal: alert.ai_proposal || null },
        { tm_case_id: out.tm_case_id, case_ref: out.case_ref, created_case: created, case_grouping: mode, ai_followed: followed },
        created ? `Alert ${alert.ref || alert.id} escalated: investigation ${out.case_ref} started.` : `Alert ${alert.ref || alert.id} escalated: added to investigation ${out.case_ref}.`);
      return Response.json({ ok: true, tm_case_id: out.tm_case_id, case_ref: out.case_ref, created });
    }

    throw httpError(400, 'Unknown action');
  } catch (error) {
    console.error('tmAlertActions error:', error?.message);
    return errorResponse(error);
  }
}