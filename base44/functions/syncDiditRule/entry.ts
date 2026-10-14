// syncDiditRule — keeps TM rules in step with Didit.
//  { mode: 'drift' }              compare every synced rule with Didit and flag differences (scheduled nightly at 04:00 UTC by
//                                 the workflow 'Nightly Didit Rule Drift'; a signed-in manager runs it for their own tenant only). Read-only towards Didit.
//  { rule_id, force? }            retry a failed push (tmManageRules). A rule that drifted is only overwritten with force=true, a deliberate choice.
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.52';
import { isTmEnabled } from '../../shared/tmGuards.js';
import { asList, authenticate, errorResponse, httpError, loadTenant } from '../../shared/tmAuth.js';
import { MANAGE_ROLES } from '../../shared/tmRuleSchema.js';
import { loadRule } from '../../shared/tmRuleActions.js';
import { syncRule, driftCheckTenant, errText } from '../../shared/tmRuleSync.js';

export default async function (req) {
  try {
    const base44 = createClientFromRequest(req);
    let body: any = {};
    try { body = await req.json(); } catch { body = {}; }

    if (body.rule_id) {
      const auth = await authenticate(base44, req, body, { roles: MANAGE_ROLES, allowApiKey: false });
      const tenant = await loadTenant(base44, auth.tenantId);
      if (!isTmEnabled(tenant, 'tm_rules')) throw httpError(403, 'Feature tm_rules is not enabled');
      const E = base44.asServiceRole.entities;
      const rule = await loadRule(E, auth.tenantId, body.rule_id);
      if (rule.mode === 'draft' && rule.approval_status !== 'approved') throw httpError(409, 'Only an approved rule is registered in Didit');
      const res = await syncRule({ base44, E, auth, tenantId: auth.tenantId, tenant }, rule, { force: !!body.force });
      if (!res.ok) throw httpError(502, `Didit did not accept the rule: ${res.error}`);
      return Response.json({ ok: true, rule_id: rule.id, sync_status: res.rule.sync_status });
    }

    if (body.mode !== 'drift') throw httpError(400, 'Send { mode: "drift" } or { rule_id }');
    const user = await base44.auth.me().catch(() => null);
    let onlyTenant = null;
    if (user) {
      const role = user.app_role || user.data?.app_role;
      if (!MANAGE_ROLES.includes(role)) throw httpError(403, 'Forbidden');
      onlyTenant = user.tenant_id || user.data?.tenant_id;
      if (!onlyTenant) throw httpError(403, 'No tenant associated with this user');
    }
    const tenants = asList(await base44.asServiceRole.entities.Tenant.list('-created_date', 1000))
      .filter((t) => t.status !== 'Suspended' && t.didit_api_key && isTmEnabled(t, 'tm_rules') && (!onlyTenant || t.id === onlyTenant));
    const results = [];
    for (const tenant of tenants) {
      try { results.push(await driftCheckTenant(base44, tenant)); } catch (e) { results.push({ tenant_id: tenant.id, error: errText(e) }); }
    }
    return Response.json({ ok: true, tenants: results.length, results });
  } catch (error) {
    console.error('syncDiditRule error:', error?.message);
    return errorResponse(error);
  }
}