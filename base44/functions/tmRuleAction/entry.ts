// tmRuleAction — lifecycle actions on TM rules.
// Auth: signed-in user; tenant from the user. Requires tm_rules.
// save / request_approval / set_mode / retire / seed_starters: tmManageRules. approve / reject: tmApproveRules (Admin or Compliance) and never the creator.
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.52';
import { isTmEnabled } from '../../shared/tmGuards.js';
import { authenticate, errorResponse, httpError, loadTenantWithDiditCredentials } from '../../shared/tmAuth.js';
import { roleOf } from '../../shared/tmCaseCommon.js';
import { MANAGE_ROLES, APPROVE_ROLES } from '../../shared/tmRuleSchema.js';
import { loadRule, saveRule, requestApproval, approveRule, rejectRule, setMode, retireRule } from '../../shared/tmRuleActions.js';
import { seedStarterRules } from '../../shared/tmRuleStarters.js';

export default async function (req) {
  try {
    const base44 = createClientFromRequest(req);
    const body = await req.json();
    const auth = await authenticate(base44, req, body, { roles: [...new Set([...MANAGE_ROLES, ...APPROVE_ROLES])], allowApiKey: false });
    const tenantId = auth.tenantId;
    const tenant = await loadTenantWithDiditCredentials(base44, tenantId);
    if (!isTmEnabled(tenant, 'tm_rules')) throw httpError(403, 'Feature tm_rules is not enabled');
    const role = roleOf(await base44.auth.me());
    const action = body.action;
    const approving = action === 'approve' || action === 'reject';
    if (!approving && !MANAGE_ROLES.includes(role)) throw httpError(403, 'You do not have permission to manage rules');
    if (approving && !APPROVE_ROLES.includes(role)) throw httpError(403, 'Only an Admin or Compliance approver can decide on a rule');

    const E = base44.asServiceRole.entities;
    const ctx = { base44, E, auth, tenantId, tenant };
    let result;
    if (action === 'save') result = await saveRule(ctx, body);
    else if (action === 'seed_starters') result = await seedStarterRules(ctx);
    else {
      const rule = await loadRule(E, tenantId, body.rule_id);
      if (action === 'request_approval') result = await requestApproval(ctx, rule);
      else if (action === 'approve') result = await approveRule(ctx, rule, body);
      else if (action === 'reject') result = await rejectRule(ctx, rule, body);
      else if (action === 'set_mode') result = await setMode(ctx, rule, body);
      else if (action === 'retire') result = await retireRule(ctx, rule, body);
      else throw httpError(400, 'Unknown action');
    }
    return Response.json({ ok: true, ...result });
  } catch (error) {
    console.error('tmRuleAction error:', error?.message);
    return errorResponse(error);
  }
}