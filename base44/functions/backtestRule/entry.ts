// backtestRule — runs a Didit backtest for one rule version, stores a RuleBacktest and asks the AI for ONE tuning suggestion (never applied).
// Auth: signed-in user with tmManageRules; tenant from the user. Requires tm_rules and a Didit API key.
// Didit's backtest is stateless (POST /v3/transactions/rules/backtest/), so nothing is created in Didit for it.
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.52';
import { isTmEnabled } from '../../shared/tmGuards.js';
import { authenticate, errorResponse, httpError, loadTenant } from '../../shared/tmAuth.js';
import { MANAGE_ROLES } from '../../shared/tmRuleSchema.js';
import { loadRule } from '../../shared/tmRuleActions.js';
import { runRuleBacktest } from '../../shared/tmRuleBacktest.js';

export default async function (req) {
  try {
    const base44 = createClientFromRequest(req);
    const body = await req.json();
    const auth = await authenticate(base44, req, body, { roles: MANAGE_ROLES, allowApiKey: false });
    const tenantId = auth.tenantId;
    const tenant = await loadTenant(base44, tenantId);
    if (!isTmEnabled(tenant, 'tm_rules')) throw httpError(403, 'Feature tm_rules is not enabled');
    if (!tenant.didit_api_key) throw httpError(400, 'Didit is not connected for this organisation');
    const E = base44.asServiceRole.entities;
    const rule = await loadRule(E, tenantId, body.rule_id);
    const result = await runRuleBacktest({ base44, E, auth, tenantId, tenant }, rule, { window_from: body.window_from, window_to: body.window_to });
    return Response.json({ ok: true, ...result });
  } catch (error) {
    console.error('backtestRule error:', error?.message);
    return errorResponse(error);
  }
}