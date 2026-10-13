// manageTmCase — audited TM investigation case actions (create, alerts, evidence, escalation, decisions, EDR, customer requests).
// Auth: signed-in user with tmWorkCase; tenant from the user. Requires tm_core. Every action appends to the case timeline and writes an AuditEvent.
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.52';
import { isTmEnabled } from '../../shared/tmGuards.js';
import { authenticate, errorResponse, httpError, loadTenant, WORK_ROLES } from '../../shared/tmAuth.js';
import { loadCase } from '../../shared/tmCaseCommon.js';
import {
  createCase, addAlerts, removeAlerts, collectCaseEvidence, acceptEvidence, editEvidence, addNote, escalateToCo, coDecide, recordDecision,
} from '../../shared/tmCaseCore.js';
import { openEdr, requestInfo, reverifyIdentity, openNetworkCase } from '../../shared/tmCaseClient.js';

const ACTIONS = {
  create: createCase,
  add_alerts: addAlerts,
  remove_alerts: removeAlerts,
  collect_evidence: collectCaseEvidence,
  accept_evidence: acceptEvidence,
  edit_evidence: editEvidence,
  add_note: addNote,
  escalate_to_co: escalateToCo,
  co_decide: coDecide,
  record_decision: recordDecision,
  open_edr: openEdr,
  request_info: requestInfo,
  reverify_identity: reverifyIdentity,
  open_network_case: openNetworkCase,
};

export default async function (req) {
  try {
    const base44 = createClientFromRequest(req);
    const body = await req.json();
    const run = ACTIONS[body.action];
    if (!run) throw httpError(400, 'Unknown action');
    const auth = await authenticate(base44, req, body, { roles: WORK_ROLES, allowApiKey: false });
    const user = await base44.auth.me();
    const tenant = await loadTenant(base44, auth.tenantId);
    if (!isTmEnabled(tenant, 'tm_core')) throw httpError(403, 'Feature tm_core is not enabled');
    const E = base44.asServiceRole.entities;
    const ctx = { base44, E, auth: { ...auth, role: user.app_role || user.data?.app_role }, tenantId: auth.tenantId, tenant };
    const tmCase = body.action === 'create' ? null : await loadCase(E, ctx.tenantId, body.tm_case_id);
    const result = await run(ctx, tmCase, body);
    return Response.json({ ok: true, ...result });
  } catch (error) {
    console.error('manageTmCase error:', error?.message);
    return errorResponse(error);
  }
}