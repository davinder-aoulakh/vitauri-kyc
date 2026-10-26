// diditRuleLibrary — Didit's preset rule library and Didit rules that Vitauri does not manage.
// Auth: signed-in user; tenant from the user. 'list' for tmManageRules or tmApproveRules; every other action needs tmManageRules. Requires tm_rules. Reads from Didit only, never writes to it.
//  { action: 'list', search?, category?, bundle?, limit?, offset? }   library entries in readable form (+ whether each can be imported)
//  { action: 'import', library_key, title?, scenario_id?, owner_user_id? }  creates a Vitauri draft (needs approval, then syncs)
//  { action: 'scan' }                                              records Didit rules without a Vitauri rule (also runs nightly)
//  { action: 'adopt', rule_id, scenario_id?, owner_user_id?, review_date?, change_note? }  unmanaged -> draft
//  { action: 'acknowledge', rule_id, reason }                      unmanaged rule marked as known
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.52';
import { isTmEnabled } from '../../shared/tmGuards.js';
import { authenticate, errorResponse, httpError, loadTenantWithDiditCredentials } from '../../shared/tmAuth.js';
import { MANAGE_ROLES, APPROVE_ROLES } from '../../shared/tmRuleSchema.js';
import { roleOf } from '../../shared/tmCaseCommon.js';
import { loadRule } from '../../shared/tmRuleActions.js';
import { errText } from '../../shared/tmRuleSync.js';
import { isPathMissing } from '../../shared/diditTm.js';
import { listLibrary, importLibraryRule, recordUnmanagedRules, adoptUnmanaged, acknowledgeUnmanaged } from '../../shared/tmDiditLibrary.js';

const NEEDS_DIDIT = ['list', 'import', 'scan'];

export default async function (req) {
  try {
    const base44 = createClientFromRequest(req);
    let body: any = {};
    try { body = await req.json(); } catch { body = {}; }
    const auth = await authenticate(base44, req, body, { roles: [...new Set([...MANAGE_ROLES, ...APPROVE_ROLES])], allowApiKey: false });
    const tenant = await loadTenantWithDiditCredentials(base44, auth.tenantId);
    if (!isTmEnabled(tenant, 'tm_rules')) throw httpError(403, 'Feature tm_rules is not enabled');
    const action = body.action;
    if (action !== 'list' && !MANAGE_ROLES.includes(roleOf(await base44.auth.me()))) throw httpError(403, 'You do not have permission to manage rules');
    if (NEEDS_DIDIT.includes(action) && !tenant.didit_api_key) throw httpError(412, 'Didit is not connected for this tenant');

    const E = base44.asServiceRole.entities;
    const ctx = { base44, E, auth, tenantId: auth.tenantId, tenant };
    let result;
    try {
      if (action === 'list') result = await listLibrary(ctx, body);
      else if (action === 'import') result = await importLibraryRule(ctx, body);
      else if (action === 'scan') result = await recordUnmanagedRules(ctx);
      else if (action === 'adopt') result = await adoptUnmanaged(ctx, await loadRule(E, auth.tenantId, body.rule_id), body);
      else if (action === 'acknowledge') result = await acknowledgeUnmanaged(ctx, await loadRule(E, auth.tenantId, body.rule_id), body);
      else throw httpError(400, 'Unknown action');
    } catch (e) {
      if (isPathMissing(e) && NEEDS_DIDIT.includes(action)) throw httpError(424, 'The Didit rule library is not available on this Didit plan');
      if (e?.status && !e?.message && e?.detail !== undefined) throw httpError(502, `Didit did not answer as expected: ${errText(e)}`);
      throw e;
    }
    return Response.json({ ok: true, ...result });
  } catch (error) {
    console.error('diditRuleLibrary error:', error?.message);
    return errorResponse(error);
  }
}
