// decideEdrTrigger — accept or dismiss a proposed EdrTrigger. Requires tm_core.
// Auth: signed-in user with tmWorkCase, or a Director; tenant from the user.
//   accept  { edr_trigger_id }                  -> creates a KycCase (Event_Driven_Review), links it, status accepted
//   dismiss { edr_trigger_id, dismiss_reason }  -> status dismissed
//   respond { edr_trigger_id, response, reason } -> graduated response (Change of circumstances page):
//       no_action closes the event; targeted_check / risk_reassessment / full_cdd_refresh open the review with only
//       the steps the event touches (base44/shared/cocResponse.js). Also open to Compliance Admin and Tenant Admin.
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.52';
import { isTmEnabled } from '../../shared/tmGuards.js';
import { authenticate, errorResponse, httpError, loadTenant, asList, WORK_ROLES, ACCOUNT_ROLES } from '../../shared/tmAuth.js';
import { RESPONSES, RESPONSE_LABEL, STEP_LABEL, stepsForResponse } from '../../shared/cocResponse.js';
import { writeAudit } from '../../shared/tmAudit.js';
import { TRIGGER_LABEL } from '../../shared/edrTriggers.js';

const isoDate = (d) => d.toISOString().slice(0, 10);

export default async function (req) {
  try {
    const base44 = createClientFromRequest(req);
    const body = await req.json();
    const auth = await authenticate(base44, req, body, { roles: body?.action === 'respond' ? [...ACCOUNT_ROLES, 'Director'] : [...WORK_ROLES, 'Director'], allowApiKey: false });
    const tenantId = auth.tenantId;
    const tenant = await loadTenant(base44, tenantId);
    if (!isTmEnabled(tenant, 'tm_core')) throw httpError(403, 'Feature tm_core is not enabled');
    const E = base44.asServiceRole.entities;

    if (!body.edr_trigger_id) throw httpError(400, 'edr_trigger_id is required');
    const trigger = asList(await E.EdrTrigger.filter({ tenant_id: tenantId, id: body.edr_trigger_id }, undefined, 1))[0];
    if (!trigger || trigger.tenant_id !== tenantId) throw httpError(404, 'EDR trigger not found');
    if (trigger.status !== 'proposed') throw httpError(409, `This trigger is already ${trigger.status}`);
    const nowIso = new Date().toISOString();
    const label = TRIGGER_LABEL[trigger.trigger_type] || trigger.trigger_type;
    const summary = trigger.after?.summary || '';

    if (body.action === 'dismiss') {
      const reason = String(body.dismiss_reason || '').trim();
      if (reason.length < 5) throw httpError(400, 'A dismiss reason is required');
      await E.EdrTrigger.update(trigger.id, { status: 'dismissed', dismiss_reason: reason, decided_by_user_id: auth.actorUserId, decided_at: nowIso });
      await writeAudit(base44, auth, {
        tenantId, clientId: trigger.client_id, eventType: 'edr_trigger_dismissed',
        before: { status: 'proposed' }, after: { status: 'dismissed', edr_trigger_id: trigger.id, dismiss_reason: reason },
        notes: `EDR trigger dismissed (${label}) by ${auth.actorName}: ${reason}`,
      });
      return Response.json({ ok: true, status: 'dismissed' });
    }

    // Graduated response. 'accept' and 'dismiss' above/below are unchanged.
    let plan = null; let responseReason = '';
    if (body.action === 'respond') {
      if (!RESPONSES.includes(body.response)) throw httpError(400, `response must be one of: ${RESPONSES.join(', ')}`);
      responseReason = String(body.reason || '').trim();
      plan = stepsForResponse(trigger.trigger_type, body.response);
      if (!plan.createsReview) {
        if (responseReason.length < 10) throw httpError(400, 'A reason of at least 10 characters is required to close an event without action');
        await E.EdrTrigger.update(trigger.id, { status: 'dismissed', response: body.response, response_reason: responseReason, dismiss_reason: responseReason, decided_by_user_id: auth.actorUserId, decided_at: nowIso });
        await writeAudit(base44, auth, {
          tenantId, clientId: trigger.client_id, eventType: 'change_event_responded',
          before: { status: 'proposed' }, after: { status: 'dismissed', edr_trigger_id: trigger.id, response: body.response, reason: responseReason },
          notes: `Change of circumstances (${label}) closed with no action by ${auth.actorName}: ${responseReason}`,
        });
        return Response.json({ ok: true, status: 'dismissed', response: body.response });
      }
      if (responseReason.length < 5) throw httpError(400, 'A reason is required');
    } else if (body.action !== 'accept') throw httpError(400, "action must be 'accept', 'dismiss' or 'respond'");
    const client = asList(await E.Client.filter({ tenant_id: tenantId, id: trigger.client_id }, undefined, 1))[0];
    if (!client) throw httpError(404, 'Client not found');
    // Same fields as the EDR case created from a monitoring alert (AlertDetailPanel.escalateToEDR).
    const prevCase = asList(await E.KycCase.filter({ tenant_id: tenantId, client_id: client.id, status: 'Approved' }, '-created_date', 1))[0] || null;
    const dueDate = isoDate(new Date(Date.now() + 30 * 86400000));
    const triggerReason = plan
      ? `Change of circumstances: ${label}${summary ? ` — ${summary}` : ''} · ${RESPONSE_LABEL[body.response]}`
      : `EDR trigger: ${label}${summary ? ` — ${summary}` : ''}`;
    // Carry the trigger's evidence into the review: what changed (before/after), linked TM alert or case, risk at open.
    const ref = String(trigger.source_ref || '');
    const alertIds = [trigger.after?.tm_alert_id, ...(Array.isArray(trigger.after?.tm_alert_ids) ? trigger.after.tm_alert_ids : []), ref.startsWith('alert:') ? ref.slice(6) : null].filter(Boolean);
    const tmCaseId = trigger.after?.tm_case_id || (ref.startsWith('tm_case:') ? ref.slice(8) : null);
    const tmContext = {
      opened_by: 'edr_trigger', at: nowIso,
      score: client.customer_risk_score ?? null, band: client.customer_risk_band || null,
      ...(plan ? { response: body.response, response_reason: responseReason, required_steps: plan.required } : {}),
      trigger: {
        id: trigger.id, type: trigger.trigger_type, label, summary: summary || null,
        before: trigger.before || {}, after: trigger.after || {}, source_ref: trigger.source_ref || null, proposed_at: trigger.created_date || null,
      },
    };
    const kyc = await E.KycCase.create({
      tm_context: tmContext,
      ...(alertIds.length ? { tm_alert_ids: [...new Set(alertIds)] } : {}),
      ...(tmCaseId ? { tm_case_id: tmCaseId } : {}),
      tenant_id: tenantId, client_id: client.id, case_type: 'Event_Driven_Review', status: 'Draft',
      assigned_analyst_id: prevCase?.assigned_analyst_id || auth.actorUserId, trigger_reason: triggerReason, due_date: dueDate,
      created_by_user_id: auth.actorUserId, previous_case_id: prevCase?.id || null, is_re_onboarding: false,
      risk_classification: prevCase?.risk_classification || null,
      step_1_status: 'not_started', step_2_status: 'not_started', step_3_status: 'not_started', step_4_status: 'not_started',
      step_5_status: 'not_started', step_6_status: 'not_started', step_7_status: 'not_started', step_8_status: 'not_started',
      ...(plan ? { ...plan.flags, delta_response: body.response } : {}),
    });
    await E.EdrTrigger.update(trigger.id, {
      status: 'accepted', kyc_case_id: kyc.id, decided_by_user_id: auth.actorUserId, decided_at: nowIso,
      ...(plan ? { response: body.response, response_reason: responseReason } : {}),
    });
    await writeAudit(base44, auth, {
      tenantId, clientId: client.id, eventType: 'edr_trigger_accepted',
      before: { status: 'proposed' }, after: { status: 'accepted', edr_trigger_id: trigger.id, kyc_case_id: kyc.id, ...(plan ? { response: body.response, reason: responseReason, required_steps: plan.required } : {}) },
      notes: plan
        ? `Change of circumstances (${label}): ${RESPONSE_LABEL[body.response]} chosen by ${auth.actorName}; review ${kyc.id} opened for ${plan.required.map((n) => STEP_LABEL[n]).join(', ')}. Reason: ${responseReason}`
        : `EDR trigger accepted (${label}) by ${auth.actorName}; event-driven review ${kyc.id} opened.`,
    });
    await E.AuditEvent.create({
      tenant_id: tenantId, case_id: kyc.id, client_id: client.id, actor_user_id: auth.actorUserId, actor_name: auth.actorName,
      actor_type: auth.actorType, event_type: 'edr_case_created_from_trigger', before_state: {}, after_state: { edr_trigger_id: trigger.id },
      notes: triggerReason,
    });
    if (prevCase?.assigned_analyst_id && prevCase.assigned_analyst_id !== auth.actorUserId) {
      await E.Notification.create({
        tenant_id: tenantId, user_id: prevCase.assigned_analyst_id, type: 'case_assigned', title: 'New EDR Case Assigned',
        body: `An Event-Driven Review has been opened for ${client.full_name} (${label}). Due: ${dueDate}`, link_case_id: kyc.id,
      }).catch(() => {});
    }
    return Response.json({ ok: true, status: 'accepted', kyc_case_id: kyc.id, ...(plan ? { response: body.response, required_steps: plan.required } : {}) });
  } catch (error) {
    console.error('decideEdrTrigger error:', error?.message);
    return errorResponse(error);
  }
}
