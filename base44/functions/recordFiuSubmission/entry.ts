// recordFiuSubmission — records the FIU submission, receipt and outcome of a generated report, with evidence.
// Auth: signed-in Compliance Officer (tmApproveFiuReport); tenant from the user.
// Actions: submitted {method, at, evidence_file}, received {fiu_reference, at, evidence_file?}, accepted, rejected {reason}.
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.52';
import { isTmEnabled } from '../../shared/tmGuards.js';
import { authenticate, errorResponse, httpError, loadTenant, asList } from '../../shared/tmAuth.js';
import { CO_ROLES } from '../../shared/tmCaseCommon.js';
import { loadReport } from '../../shared/tmFiuActions.js';
import { writeAudit } from '../../shared/tmAudit.js';

const METHODS = ['portal_upload', 'xml_upload', 'm2m'];
const FROM = { submitted: ['generated'], received: ['submitted'], accepted: ['received'], rejected: ['submitted', 'received'] };

const when = (v) => {
  if (!v) return new Date().toISOString();
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) throw httpError(400, 'Invalid date');
  if (d.getTime() > Date.now() + 5 * 60000) throw httpError(400, 'The time cannot be in the future');
  return d.toISOString();
};

export default async function (req) {
  try {
    const base44 = createClientFromRequest(req);
    const body = await req.json();
    const auth = await authenticate(base44, req, body, { roles: CO_ROLES, allowApiKey: false });
    const tenantId = auth.tenantId;
    const tenant = await loadTenant(base44, tenantId);
    if (!isTmEnabled(tenant, 'tm_core')) throw httpError(403, 'Feature tm_core is not enabled');
    if (!isTmEnabled(tenant, 'tm_fiu')) throw httpError(403, 'Feature tm_fiu is not enabled');
    const E = base44.asServiceRole.entities;
    const report = await loadReport(E, tenantId, body.report_id);
    const action = body.action;
    if (!FROM[action]) throw httpError(400, 'Unknown action');
    if (!FROM[action].includes(report.status)) throw httpError(409, `A ${report.status} report cannot be marked ${action}`);

    const evidence = String(body.evidence_file || '').trim();
    let patch;
    if (action === 'submitted') {
      if (!METHODS.includes(body.method)) throw httpError(400, 'method must be portal_upload, xml_upload or m2m');
      if (!evidence) throw httpError(400, 'Evidence of the submission is required');
      patch = { status: 'submitted', submitted: { at: when(body.at), method: body.method, by_user_id: auth.actorUserId, evidence_url: evidence } };
    } else if (action === 'received') {
      const ref = String(body.fiu_reference || '').trim();
      if (!ref) throw httpError(400, 'The FIU reference is required');
      patch = { status: 'received', received: { fiu_reference: ref, at: when(body.at), ...(evidence ? { evidence_url: evidence } : {}) } };
    } else {
      const reason = String(body.reason || '').trim();
      if (action === 'rejected' && reason.length < 5) throw httpError(400, 'A reason is required');
      patch = action === 'rejected' ? { status: 'rejected', rejection_reason: reason } : { status: 'accepted' };
    }
    await E.FiuReport.update(report.id, patch);
    await writeAudit(base44, auth, {
      tenantId, clientId: report.client_id, eventType: `fiu_report_${action}`,
      before: { status: report.status }, after: { status: patch.status, method: patch.submitted?.method, fiu_reference: patch.received?.fiu_reference, reason: patch.rejection_reason, evidence: !!evidence },
      notes: `FIU report ${report.report_ref} marked ${action} by ${auth.actorName}.`,
    });

    let caseClosed = false;
    if (['received', 'accepted'].includes(patch.status) && report.tm_case_id) {
      const all = asList(await E.FiuReport.filter({ tenant_id: tenantId, tm_case_id: report.tm_case_id }, undefined, 50)).filter((r) => r.status !== 'rejected');
      const statusOf = (r) => (r.id === report.id ? patch.status : r.status);
      if (all.length && all.every((r) => ['received', 'accepted'].includes(statusOf(r)))) {
        const tmCase = asList(await E.TmCase.filter({ tenant_id: tenantId, id: report.tm_case_id }))[0];
        if (tmCase && tmCase.status !== 'closed') {
          const entry = { at: new Date().toISOString(), kind: 'fiu_report', by: auth.actorName, text: 'All FIU reports received. Case closed.' };
          await E.TmCase.update(tmCase.id, { status: 'closed', timeline: [...(tmCase.timeline || []), entry] });
          await writeAudit(base44, auth, { tenantId, clientId: tmCase.primary_client_id, eventType: 'tm_case_closed', before: { status: tmCase.status }, after: { status: 'closed' }, notes: `TM case ${tmCase.case_ref || tmCase.id} closed: all FIU reports received.` });
          caseClosed = true;
        }
      }
    }
    return Response.json({ ok: true, report_id: report.id, status: patch.status, case_closed: caseClosed });
  } catch (error) {
    console.error('recordFiuSubmission error:', error?.message);
    return errorResponse(error);
  }
}