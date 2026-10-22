// Files FIU report artefacts (goAML XML, PDF, submission evidence, FIU receipt) to the customer file as FiuArtefact rows.
// Never creates Document rows. Each filing appends to FiuReport.filed_document_ids and writes an AuditEvent on the client.
import { asList } from './tmAuth.js';
import { writeAudit } from './tmAudit.js';

const KIND_LABEL = { goaml_xml: 'goAML XML', report_pdf: 'Report PDF', submission_evidence: 'Submission evidence', fiu_receipt: 'FIU receipt' };

/** items: [{ kind, file_url?, file_name, file_hash? }]. Idempotent per (report, kind, file_url, file_name). Returns created ids. */
export async function fileArtefacts(ctx, report, items) {
  const { E, tenantId, auth } = ctx;
  const existing = asList(await E.FiuArtefact.filter({ tenant_id: tenantId, fiu_report_id: report.id }, undefined, 100));
  const created = [];
  const at = new Date().toISOString();
  for (const it of items) {
    if (existing.some((a) => a.kind === it.kind && (a.file_url || '') === (it.file_url || '') && (a.file_name || '') === (it.file_name || ''))) continue;
    const row = await E.FiuArtefact.create({
      tenant_id: tenantId, client_id: report.client_id, fiu_report_id: report.id, kind: it.kind,
      file_url: it.file_url || undefined, file_name: it.file_name, file_hash: it.file_hash || undefined,
      kyc_case_id: report.kyc_case_id || undefined, tm_case_id: report.tm_case_id || undefined,
      filed_at: at, filed_by: auth.actorName,
    });
    created.push(row.id);
    await writeAudit(ctx.base44, auth, {
      tenantId, clientId: report.client_id, eventType: 'fiu_artefact_filed',
      before: {}, after: { artefact_id: row.id, fiu_report_id: report.id, kind: it.kind, file_name: it.file_name, file_hash: it.file_hash || null },
      notes: `${KIND_LABEL[it.kind] || it.kind} for FIU report ${report.report_ref} filed to the customer file.`,
    });
  }
  if (created.length) {
    const fresh = asList(await E.FiuReport.filter({ tenant_id: tenantId, id: report.id }, undefined, 1))[0] || report;
    await E.FiuReport.update(report.id, { filed_document_ids: [...new Set([...(fresh.filed_document_ids || []), ...created])] });
  }
  return created;
}

/** Best-effort wrapper: a filing failure never undoes the lifecycle step that preceded it. */
export async function safeFileArtefacts(ctx, report, items) {
  try { return await fileArtefacts(ctx, report, items); } catch (e) { console.warn('FIU artefact filing failed:', e?.message); return []; }
}
