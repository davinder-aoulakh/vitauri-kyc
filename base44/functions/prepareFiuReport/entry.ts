// prepareFiuReport — one-click FIU report preparation from a TM case or alert.
// Auth: signed-in user with tmWorkCase (tenant from the user), OR the internal auto-draft call { auto: true, alert_id }
// from the "Auto-draft FIU Report" workflow, where the tenant comes from the alert record itself and the tenant must have
// tm_settings.auto_draft_objective_reports = true and the alert must be objective. Requires tm_core + tm_fiu.
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.52';
import { isTmEnabled } from '../../shared/tmGuards.js';
import { authenticate, errorResponse, httpError, loadTenant, asList, WORK_ROLES } from '../../shared/tmAuth.js';
import { roleOf } from '../../shared/tmCaseCommon.js';
import { prepareReport } from '../../shared/tmFiuPrepare.js';

export default async function (req) {
  let auto = false;
  try {
    const base44 = createClientFromRequest(req);
    const body = await req.json().catch(() => ({}));
    const E = base44.asServiceRole.entities;
    const user = await base44.auth.me().catch(() => null);
    let auth;
    let tenantId;
    if (user) {
      auth = await authenticate(base44, req, body, { roles: WORK_ROLES, allowApiKey: false });
      auth.role = roleOf(user);
      tenantId = auth.tenantId;
    } else {
      if (!body.auto || !body.alert_id) throw httpError(401, 'Unauthorized');
      auto = true;
      const alert = asList(await E.TmAlert.filter({ id: body.alert_id }))[0];
      if (!alert?.tenant_id) throw httpError(404, 'Alert not found');
      tenantId = alert.tenant_id;
      auth = { mode: 'system', tenantId, actorType: 'System', actorName: 'Auto-draft (objective alert)', actorUserId: undefined, role: 'System' };
      const t = await loadTenant(base44, tenantId);
      if (t.tm_settings?.auto_draft_objective_reports !== true) return Response.json({ ok: true, skipped: 'Auto-draft is not enabled for this tenant' });
      if (alert.indicator_type !== 'objective') return Response.json({ ok: true, skipped: 'Alert is not objective' });
    }
    const tenant = await loadTenant(base44, tenantId);
    if (!isTmEnabled(tenant, 'tm_core')) throw httpError(403, 'Feature tm_core is not enabled');
    if (!isTmEnabled(tenant, 'tm_fiu')) throw httpError(403, 'Feature tm_fiu is not enabled');

    const ctx = { base44, E, auth, tenantId, tenant };
    const result = await prepareReport(ctx, {
      tmCaseId: body.tm_case_id, alertId: body.alert_id, kycCaseId: body.kyc_case_id, profileCode: body.fiu_profile_code, refresh: !auto,
    });
    return Response.json({ ok: true, ...result });
  } catch (error) {
    if (auto && error?.status === 409) return Response.json({ ok: true, skipped: error.message });
    console.error('prepareFiuReport error:', error?.message);
    return errorResponse(error);
  }
}