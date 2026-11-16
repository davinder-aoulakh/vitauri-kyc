// recordFiuSubmission — records the FIU submission, receipt and outcome of a generated report, with evidence.
// Auth: signed-in Compliance Officer (tmApproveFiuReport); tenant from the user.
// Actions: submitted {method, at, evidence_file, fiu_reference?}, received {fiu_reference?, at, evidence_file?}, accepted, rejected {reason}.
// With the KYC + AML layout (aml_nav_v2) the FIU reference is required at submission, the receipt may reuse it, and a
// receipt proposes a restricted change-of-circumstances event (base44/shared/tmFiuSubmission.js).
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.52';
import { isTmEnabled } from '../../shared/tmGuards.js';
import { authenticate, errorResponse, httpError, loadTenant, asList } from '../../shared/tmAuth.js';
import { CO_ROLES } from '../../shared/tmCaseCommon.js';
import { loadReport } from '../../shared/tmFiuActions.js';
import { writeAudit } from '../../shared/tmAudit.js';
import { safeFileArtefacts } from '../../shared/tmFiuArtefacts.js';
import { refreshAmlHoldForCase } from '../../shared/tippingOff.js';
import { proposeTriggers } from '../../shared/edrTriggers.js';
import { amlV2On, submissionCheck, receiptReference, outcomeFinding, hasOpenEventForCase } from '../../shared/tmFiuSubmission.js';

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
    const auth = await authenticate(base44, req, body, { domain: 'aml', roles: CO_ROLES, allowApiKey: false });
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
    const v2 = amlV2On(tenant);
    let patch;
    if (action === 'submitted') {
      const chk = submissionCheck(body, { v2 });
      if (chk.error) throw httpError(400, chk.error);
      patch = { status: 'submitted', submitted: { at: when(body.at), method: chk.method, by_user_id: auth.actorUserId, evidence_url: chk.evidence, ...(chk.reference ? { fiu_reference: chk.reference } : {}) } };
    } else if (action === 'received') {
      const ref = receiptReference(report, body);
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
      before: { status: report.status }, after: { status: patch.status, method: patch.submitted?.method, fiu_reference: patch.received?.fiu_reference || patch.submitted?.fiu_reference, reason: patch.rejection_reason, evidence: !!evidence },
      notes: `FIU report ${report.report_ref} marked ${action} by ${auth.actorName}.`,
    });

    // File submission evidence / FIU receipt to the customer file (FiuArtefact only, never Document).
    const fctx = { base44, E, auth, tenantId };
    if (action === 'submitted') {
      await safeFileArtefacts(fctx, report, [{ kind: 'submission_evidence', file_url: evidence, file_name: `Submission evidence ${report.report_ref}` }]);
    } else if (action === 'received') {
      await safeFileArtefacts(fctx, report, [{ kind: 'fiu_receipt', file_url: evidence || undefined, file_name: `FIU reference ${patch.received.fiu_reference}` }]);
    }

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
          await refreshAmlHoldForCase(base44, tenantId, { ...tmCase, status: 'closed' }, auth);
        }
      }
    }
    // Receipt by the FIU is a change of circumstances for the KYC file (restricted). Not when an event for the same
    // investigation is still waiting for a response: that one stands.
    let changeEvent = false;
    if (v2 && action === 'received' && report.client_id) {
      try {
        const client = asList(await E.Client.filter({ tenant_id: tenantId, id: report.client_id }, undefined, 1))[0];
        const tmCase = report.tm_case_id ? asList(await E.TmCase.filter({ tenant_id: tenantId, id: report.tm_case_id }))[0] || null : null;
        const open = asList(await E.EdrTrigger.filter({ tenant_id: tenantId, client_id: report.client_id, status: 'proposed' }, '-created_date', 100));
        if (client && !hasOpenEventForCase(open, report.tm_case_id)) {
          const created = await proposeTriggers(E, {
            tenantId, client, sourceRef: `fiu_report:${report.id}`, actor: auth,
            findings: [outcomeFinding(report, tmCase, patch.received.fiu_reference)],
          });
          changeEvent = created.length > 0;
        }
      } catch (e) {
        console.warn('recordFiuSubmission: change-of-circumstances event failed', e?.message || e);
      }
    }
    return Response.json({ ok: true, report_id: report.id, status: patch.status, case_closed: caseClosed, change_event_created: changeEvent });
  } catch (error) {
    console.error('recordFiuSubmission error:', error?.message);
    return errorResponse(error);
  }
}