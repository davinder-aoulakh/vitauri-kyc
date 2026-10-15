// unlockTippingOff — releases the tipping-off lock on a client.
// Auth: signed-in Compliance Officer (tmApproveFiuReport); tenant from the user. Allowed only when the related FIU report
// is received/accepted, or the Compliance Officer recorded a no-report decision on its case. A rationale is required.
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.52';
import { isTmEnabled } from '../../shared/tmGuards.js';
import { authenticate, errorResponse, httpError, loadTenant, asList } from '../../shared/tmAuth.js';
import { writeAudit } from '../../shared/tmAudit.js';
import { CO_ROLES } from '../../shared/tmCaseCommon.js';
import { isLockingStatus, unlockClient } from '../../shared/tippingOff.js';

const DONE = ['received', 'accepted'];

export default async function (req) {
  try {
    const base44 = createClientFromRequest(req);
    const body = await req.json();
    const auth = await authenticate(base44, req, body, { roles: CO_ROLES, allowApiKey: false });
    const tenantId = auth.tenantId;
    const tenant = await loadTenant(base44, tenantId);
    if (!isTmEnabled(tenant, 'tm_fiu')) throw httpError(403, 'Feature tm_fiu is not enabled');
    const rationale = String(body.rationale || '').trim();
    if (rationale.length < 10) throw httpError(400, 'A rationale of at least 10 characters is required');
    if (!body.client_id) throw httpError(400, 'client_id is required');
    const E = base44.asServiceRole.entities;

    const client = asList(await E.Client.filter({ tenant_id: tenantId, id: body.client_id }))[0];
    if (!client) throw httpError(404, 'Client not found');
    const activeLocks = asList(await E.TippingOffLock.filter({ tenant_id: tenantId, client_id: client.id, locked: true }, undefined, 100));
    if (!activeLocks.length) throw httpError(409, 'This client is not locked');

    const reports = asList(await E.FiuReport.filter({ tenant_id: tenantId, client_id: client.id }, undefined, 100));
    const lockRefs = new Set(activeLocks.map((l) => l.reason).filter(Boolean));
    const related = reports.filter((r) => lockRefs.has(r.report_ref));
    const scope = related.length ? related : reports;
    const caseIds = [...new Set(scope.map((r) => r.tm_case_id).filter(Boolean))];
    const cases = caseIds.length ? asList(await E.TmCase.filter({ tenant_id: tenantId, id: { $in: caseIds } }, undefined, 50)) : [];
    const noReport = new Set(cases.filter((c) => c.co_decision === 'no_report').map((c) => c.id));
    const finished = scope.some((r) => DONE.includes(r.status));
    const decidedNoReport = scope.some((r) => noReport.has(r.tm_case_id));
    if (!finished && !decidedNoReport) throw httpError(409, 'The lock can be released only after the FIU report is received/accepted or the Compliance Officer decided not to report.');
    const inFlight = reports.filter((r) => isLockingStatus(r.status) && !DONE.includes(r.status) && !noReport.has(r.tm_case_id));
    if (inFlight.length) throw httpError(409, `Another FIU report (${inFlight[0].report_ref}) is still in progress for this client.`);

    const before = { tipping_off_lock: true, tipping_off_reason: client.tipping_off_reason, tipping_off_locked_at: client.tipping_off_locked_at };
    await unlockClient(base44, { tenantId, clientId: client.id, rationale, actor: auth });
    await writeAudit(base44, auth, {
      tenantId, clientId: client.id, eventType: 'tipping_off_unlocked', before,
      after: { tipping_off_lock: false, rationale, basis: finished ? 'report_received_or_accepted' : 'no_report_decision' },
      notes: `Customer communications unlocked by ${auth.actorName}: ${rationale}`,
    });
    return Response.json({ ok: true, client_id: client.id });
  } catch (error) {
    console.error('unlockTippingOff error:', error?.message);
    return errorResponse(error);
  }
}