// listChangeEvents — events for the Change of circumstances page (phase 5). Requires tm_core. Read-only.
// Auth: any signed-in user of the tenant with an app role; tenant from the user.
//   { status?: 'proposed' | 'accepted' | 'dismissed', client_id? } -> { events: [...], can_see_aml }
// Restricted events (AML outcomes) are returned without their details to users who may not see AML data
// (cocResponse.maskTrigger with workDomain.canAml: tenant role model 'separate' and a KYC-only user).
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.52';
import { isTmEnabled } from '../../shared/tmGuards.js';
import { errorResponse, httpError, loadTenant, asList } from '../../shared/tmAuth.js';
import { TRIGGER_LABEL } from '../../shared/edrTriggers.js';
import { canAml } from '../../shared/workDomain.js';
import { maskTrigger, STATUS_LABEL, RESPONSE_LABEL, AFFECTED_STEPS, REVIEW_STEPS } from '../../shared/cocResponse.js';

const SOURCE_BY_TYPE = {
  screening_hit: 'Screening', profile_breach: 'Transaction monitoring', tm_case: 'Investigation', tm_alert_frequency: 'Transaction monitoring',
  tm_new_country: 'Transaction monitoring', tm_investigation_outcome: 'Investigation', transaction_verification: 'Transaction monitoring',
  risk_band_rise: 'Risk score', id_expiry: 'Identity document',
};

export default async function (req) {
  try {
    const base44 = createClientFromRequest(req);
    const body = await req.json().catch(() => ({}));
    const user = await base44.auth.me().catch(() => null);
    if (!user) throw httpError(401, 'Unauthorized');
    const tenantId = user.tenant_id || user.data?.tenant_id;
    const role = user.app_role || user.data?.app_role;
    if (!tenantId || !role) throw httpError(403, 'Forbidden');
    const tenant = await loadTenant(base44, tenantId);
    if (!isTmEnabled(tenant, 'tm_core')) throw httpError(403, 'Feature tm_core is not enabled');
    const E = base44.asServiceRole.entities;

    const q = { tenant_id: tenantId };
    if (['proposed', 'accepted', 'dismissed'].includes(body.status)) q.status = body.status;
    if (body.client_id) q.client_id = String(body.client_id);
    const triggers = asList(await E.EdrTrigger.filter(q, '-created_date', 500));
    const clientIds = [...new Set(triggers.map((t) => t.client_id).filter(Boolean))];
    const clients = clientIds.length ? asList(await E.Client.filter({ tenant_id: tenantId, id: { $in: clientIds } }, undefined, 1000)) : [];
    const nameOf = new Map(clients.map((c) => [c.id, { name: c.full_name, type: c.client_type || null, risk: c.risk_classification || null }]));
    const mayAml = canAml(user, tenant);

    const events = triggers.map((raw) => {
      const t = maskTrigger(raw, mayAml);
      const c = nameOf.get(t.client_id) || {};
      return {
        id: t.id, client_id: t.client_id, client_name: c.name || '—', client_type: c.type, client_risk: c.risk,
        trigger_type: t.trigger_type, type_label: TRIGGER_LABEL[t.trigger_type] || String(t.trigger_type || '').replace(/_/g, ' '),
        source_label: t.source_label || SOURCE_BY_TYPE[t.trigger_type] || 'Customer file',
        summary: t.after?.summary || '', before: t.before || {}, after: t.after || {},
        status: t.status, status_label: STATUS_LABEL[t.status] || t.status,
        response: t.response || null, response_label: t.response ? RESPONSE_LABEL[t.response] : null,
        response_reason: t.masked ? null : (raw.response_reason || raw.dismiss_reason || null),
        kyc_case_id: t.kyc_case_id || null, created_date: t.created_date, decided_at: t.decided_at || null,
        restricted: t.restricted === true, masked: t.masked === true,
        affected_steps: AFFECTED_STEPS[t.trigger_type] || REVIEW_STEPS,
      };
    });
    return Response.json({ ok: true, events, can_see_aml: mayAml });
  } catch (error) {
    console.error('listChangeEvents error:', error?.message);
    return errorResponse(error);
  }
}
