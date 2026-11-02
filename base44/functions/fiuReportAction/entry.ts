// fiuReportAction — lifecycle actions on an FIU report (before generation).
// Auth: signed-in user (tmWorkCase roles); tenant from the user. approve / reject need the Compliance Officer role (tmApproveFiuReport).
// Actions: update_field, toggle_attachment, submit_for_approval, approve, reject, checks (read only), signed_url (private file link),
// upload_generated (CO only, approved report: manual goAML XML upload), didit_status (read only: is the Didit FIU endpoint missing?),
// refresh_fields (draft / in_review only: re-run the field mapping from the file; fields edited by a user are kept).
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.52';
import { isTmEnabled } from '../../shared/tmGuards.js';
import { authenticate, errorResponse, httpError, loadTenant, WORK_ROLES } from '../../shared/tmAuth.js';
import { CO_ROLES, roleOf, loadCase, tenantUsers } from '../../shared/tmCaseCommon.js';
import { writeAudit } from '../../shared/tmAudit.js';
import { gatherReportData } from '../../shared/tmFiuGather.js';
import { buildFields, missingFields, mappedTxnCount } from '../../shared/tmFiuMap.js';
import { normaliseType, reportCodeFor } from '../../shared/fiuTypes.js';
import { loadReport, updateField, toggleAttachment, submitForApproval, approve, reject } from '../../shared/tmFiuActions.js';
import { runChecks, loadRefs } from '../../shared/tmFiuChecks.js';
import { goamlFor, pdfFor } from '../../shared/tmFiuGenerate.js';
import { uploadGenerated } from '../../shared/tmFiuUpload.js';
import { latestEndpointCheck, isMissingInCheck } from '../../shared/diditEndpointStatus.js';

async function refreshFields(ctx, report) {
  if (!['draft', 'in_review'].includes(report.status)) throw httpError(409, 'Fields can be refreshed only on a draft or in-review report');
  const { E, tenantId, tenant, auth } = ctx;
  const tmCase = report.tm_case_id ? await loadCase(E, tenantId, report.tm_case_id) : null;
  const d = await gatherReportData(ctx, tmCase, { clientId: report.client_id, alertIds: report.alert_ids || [], txnIds: report.transaction_ids || [] });
  const { fiu } = await loadRefs(ctx, report);
  const users = await tenantUsers(E, tenantId);
  const officer = users.find((u) => u.id === auth.actorUserId && CO_ROLES.includes(roleOf(u))) || users.find((u) => CO_ROLES.includes(roleOf(u)));
  const mapped = buildFields({
    tenant, officer, reportType: normaliseType(report.type), reportCode: reportCodeFor(fiu, report.type), fiu, indicatorCodes: report.indicators || [], client: d.client, accounts: d.accounts, txns: d.txns,
    counterparties: d.counterparties, parties: d.parties, cur: tenant.tm_reporting_currency || 'USD', reason: report.narrative?.text || '', idv: d.idv,
  });
  const userFields = (report.fields || []).filter((f) => f.by === 'user');
  const userPaths = new Set(userFields.map((f) => f.path));
  const fields = [...mapped.filter((f) => !userPaths.has(f.path)), ...userFields];
  const missing = missingFields(fiu?.mandatory_fields, fields, d.client);
  const transactionsMapped = mappedTxnCount(d.txns);
  await E.FiuReport.update(report.id, { fields, missing_fields: missing, transactions_mapped: transactionsMapped });
  await writeAudit(ctx.base44, auth, {
    tenantId, clientId: report.client_id, eventType: 'fiu_report_fields_refreshed',
    before: { field_count: (report.fields || []).length, missing_fields: report.missing_fields || [], transactions_mapped: report.transactions_mapped ?? null },
    after: { field_count: fields.length, missing_fields: missing, transactions_mapped: transactionsMapped, user_fields_kept: userFields.length },
    notes: `FIU report ${report.report_ref}: fields refreshed from file by ${auth.actorName} (${userFields.length} user-edited field(s) kept).`,
  });
  return { report_id: report.id, missing_fields: missing, transactions_mapped: transactionsMapped };
}

const FILE_KEYS = {
  xml: (r) => r.generated?.file_url, pdf: (r) => r.generated?.pdf_url,
  submitted: (r) => r.submitted?.evidence_url, received: (r) => r.received?.evidence_url,
};

export default async function (req) {
  try {
    const base44 = createClientFromRequest(req);
    const body = await req.json();
    const auth = await authenticate(base44, req, body, { roles: WORK_ROLES, allowApiKey: false });
    const tenantId = auth.tenantId;
    const tenant = await loadTenant(base44, tenantId);
    if (!isTmEnabled(tenant, 'tm_core')) throw httpError(403, 'Feature tm_core is not enabled');
    if (!isTmEnabled(tenant, 'tm_fiu')) throw httpError(403, 'Feature tm_fiu is not enabled');
    const user = await base44.auth.me();
    const isCO = CO_ROLES.includes(roleOf(user));
    const E = base44.asServiceRole.entities;
    const ctx = { base44, E, auth, tenantId, tenant };
    const report = await loadReport(E, tenantId, body.report_id);
    const action = body.action;

    let result;
    if (action === 'update_field') result = await updateField(ctx, report, body);
    else if (action === 'toggle_attachment') result = await toggleAttachment(ctx, report, body);
    else if (action === 'submit_for_approval') result = await submitForApproval(ctx, report);
    else if (action === 'refresh_fields') result = await refreshFields(ctx, report);
    else if (action === 'approve' || action === 'reject') {
      if (!isCO) throw httpError(403, 'Only a Compliance Officer can approve or send back a report');
      result = action === 'approve' ? await approve(ctx, report, body) : await reject(ctx, report, body);
    } else if (action === 'checks') {
      const r = await runChecks(ctx, report, { latenessReason: body.lateness_reason });
      result = { checks: r.checks, ok: r.ok, past_due: r.past_due, goaml: r.goaml };
    } else if (action === 'preview_xml' || action === 'preview_pdf') {
      // Read-only previews: the goAML XML as it would be generated now, or the PDF (DRAFT watermark until approved).
      const refs = await loadRefs(ctx, report);
      const g = goamlFor(ctx, report, refs);
      if (action === 'preview_xml') result = { xml: g.xml, validation: g.validation, file_name: `${report.report_ref}${['approved', 'draft', 'in_review'].includes(report.status) ? '.preview' : ''}.xml` };
      else {
        const draft = ['draft', 'in_review'].includes(report.status);
        const bytes = await pdfFor(ctx, report, refs, { xmlHash: report.generated?.file_hash, validation: g.validation, draft });
        let bin = '';
        for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
        result = { pdf_base64: btoa(bin), file_name: `${report.report_ref}${draft ? '.draft' : ''}.pdf` };
      }
    } else if (action === 'signed_url') {
      const uri = FILE_KEYS[body.kind]?.(report);
      if (!uri) throw httpError(404, 'File not available');
      const res = await base44.asServiceRole.integrations.Core.CreateFileSignedUrl({ file_uri: uri, expires_in: 300 });
      result = { signed_url: res.signed_url };
    } else if (action === 'upload_generated') {
      if (!isCO) throw httpError(403, 'Only a Compliance Officer can upload the goAML file');
      result = await uploadGenerated(ctx, report, body);
    } else if (action === 'didit_status') {
      const check = await latestEndpointCheck(E, tenantId);
      result = { fiu_reports_missing: isMissingInCheck(check, 'fiuReports'), checked_at: check?.checked_at || null };
    } else throw httpError(400, 'Unknown action');
    return Response.json({ ok: true, ...result });
  } catch (error) {
    console.error('fiuReportAction error:', error?.message);
    return errorResponse(error);
  }
}