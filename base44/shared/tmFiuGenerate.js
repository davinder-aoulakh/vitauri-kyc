// Generates the goAML XML and the report PDF for an APPROVED FIU report, in Vitauri (no external service needed).
// The XML is built from the reviewed fields, validated (errors stop generation), stored privately with its SHA-256, and filed
// as a goaml_xml artefact; the PDF (four-eyes block, XML hash, audit trail) is filed as report_pdf. When the tenant turns on
// tm_settings.fiu_didit_generation and a Didit template is configured, Didit is asked for its own file as well (never required).
import { asList, httpError } from './tmAuth.js';
import { writeAudit } from './tmAudit.js';
import { createDiditCase, createFiuReport, getFiuReport, downloadBinary } from './diditTm.js';
import { loadRefs } from './tmFiuChecks.js';
import { safeFileArtefacts } from './tmFiuArtefacts.js';
import { normaliseType } from './fiuTypes.js';
import { buildGoamlXml } from './goamlXml.js';
import { validateGoamlXml } from './goamlValidate.js';
import { buildFiuReportPdf } from './fiuReportPdf.js';
import { tenantUsers } from './tmCaseCommon.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pick = (r, keys) => {
  for (const k of keys) { const v = k.split('.').reduce((o, p) => o?.[p], r); if (typeof v === 'string' && v) return v; }
  return null;
};
const XML_KEYS = ['xml_url', 'goaml_xml_url', 'files.xml', 'files.xml_url', 'xml_file', 'download_url', 'file_url'];
const PDF_KEYS = ['pdf_url', 'files.pdf', 'files.pdf_url', 'pdf_file'];

export const errText = (e) => {
  const d = e?.detail;
  const s = typeof d === 'string' ? d : d ? JSON.stringify(d) : e?.message || String(e);
  return s.slice(0, 300);
};

export async function sha256Bytes(bytes) {
  const buf = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function store(base44, bytes, name, type) {
  const up = await base44.asServiceRole.integrations.Core.UploadPrivateFile({ file: new File([bytes], name, { type }) });
  if (!up?.file_uri) throw new Error('The file could not be stored');
  return up.file_uri;
}

/** XML + validation for a report (any status). issues = data the builder could not map. */
export function goamlFor(ctx, report, { fiu, client }, submittedAt) {
  const built = buildGoamlXml({ report, fiu, tenant: ctx.tenant, client, submittedAt });
  const validation = validateGoamlXml(built.xml, { type: normaliseType(report.type) });
  return { xml: built.xml, validation: { ...validation, issues: built.issues }, kind: built.kind, transactions: built.transactions };
}

/** Audit events about this report (for the PDF trail). */
async function reportAudits(ctx, report) {
  const rows = asList(await ctx.E.AuditEvent.filter({ tenant_id: ctx.tenantId, client_id: report.client_id, event_type: { $regex: '^(fiu_|tipping_off)' } }, 'created_date', 300));
  return rows.filter((a) => {
    const blob = `${a.notes || ''} ${JSON.stringify(a.after_state || {})} ${JSON.stringify(a.before_state || {})}`;
    return blob.includes(report.report_ref) || blob.includes(report.id);
  });
}

/** PDF bytes. draft = watermark (before approval). */
export async function pdfFor(ctx, report, { fiu, client }, { xmlHash, validation, draft }) {
  const [users, audits] = await Promise.all([tenantUsers(ctx.E, ctx.tenantId), reportAudits(ctx, report)]);
  return buildFiuReportPdf({ report, fiu, tenant: ctx.tenant, client, users, audits, xmlHash, validation, draft });
}

async function ensureDiditCase(ctx, tmCase, client) {
  if (tmCase?.didit_case_id) return tmCase.didit_case_id;
  const created = await createDiditCase(ctx.tenant, { vendor_data: client.id, name: `${client.full_name} · ${tmCase?.case_ref || 'FIU report'}` });
  const id = created?.id || created?.uuid || created?.case_id;
  if (!id) throw { detail: 'Didit did not return a case id' };
  if (tmCase) await ctx.E.TmCase.update(tmCase.id, { didit_case_id: id });
  return id;
}

/** Optional: Didit's own goAML file. Returns { diditId, fileUrl, pdfUrl, hash } or throws. */
async function runDiditGeneration(ctx, report, fiu, client, tmCase) {
  const t = fiu.didit_template_ids || {};
  const template = t[report.type] || t[normaliseType(report.type)] || (/^unusual_/.test(report.type || '') ? t[report.type === 'unusual_objective' ? 'objective' : 'subjective'] : null);
  if (!template) throw { detail: `No Didit template is configured for ${report.type} in the ${fiu.code} FIU profile` };
  const caseId = await ensureDiditCase(ctx, tmCase, client);
  let res = await createFiuReport(ctx.tenant, {
    template_id: template, case_id: caseId, reference: report.report_ref,
    fields: Object.fromEntries((report.fields || []).map((f) => [f.path, f.value])), narrative: report.narrative?.text || '',
  });
  const diditId = res?.id || res?.uuid || null;
  let xmlRef = pick(res, XML_KEYS);
  for (let i = 0; !xmlRef && diditId && i < 5; i++) { await sleep(2000); res = await getFiuReport(ctx.tenant, diditId); xmlRef = pick(res, XML_KEYS); }
  const inlineXml = !xmlRef && typeof res?.xml === 'string' && res.xml.trim().startsWith('<') ? new TextEncoder().encode(res.xml) : null;
  if (!xmlRef && !inlineXml) throw { detail: 'Didit has not returned a goAML XML file yet.' };
  const xml = inlineXml || await downloadBinary(ctx.tenant, xmlRef);
  if (!new TextDecoder().decode(xml.slice(0, 200)).trim().startsWith('<')) throw { detail: 'The downloaded file is not XML' };
  const pdfRef = pick(res, PDF_KEYS);
  const pdf = pdfRef ? await downloadBinary(ctx.tenant, pdfRef).catch(() => null) : null;
  const fileUrl = await store(ctx.base44, xml, `${report.report_ref}.didit.xml`, 'application/xml');
  const pdfUrl = pdf ? await store(ctx.base44, pdf, `${report.report_ref}.didit.pdf`, 'application/pdf') : undefined;
  return { diditId, fileUrl, pdfUrl, hash: await sha256Bytes(xml) };
}

export async function generateReport(ctx, report) {
  if (report.status !== 'approved') throw httpError(409, 'Only an approved report can be generated');
  const refs = await loadRefs(ctx, report);
  const { fiu, client, tmCase } = refs;
  if (!fiu) throw httpError(404, `No ${report.fiu_profile_code} FIU profile is configured`);
  const audit = (eventType, before, after, notes) => writeAudit(ctx.base44, ctx.auth, { tenantId: ctx.tenantId, clientId: report.client_id, eventType, before, after, notes });
  try {
    const at = new Date().toISOString();
    const g = goamlFor(ctx, report, refs, at);
    if (!g.validation.ok) {
      throw { status: 422, detail: `goAML validation failed: ${g.validation.errors.slice(0, 5).map((e) => e.message).join('; ')}${g.validation.errors.length > 5 ? ` (+${g.validation.errors.length - 5} more)` : ''}` };
    }
    const xmlBytes = new TextEncoder().encode(g.xml);
    const xmlHash = await sha256Bytes(xmlBytes);
    const fileUrl = await store(ctx.base44, xmlBytes, `${report.report_ref}.xml`, 'application/xml');
    const generatedAt = { ...report, status: 'generated' };
    const pdfBytes = await pdfFor(ctx, generatedAt, refs, { xmlHash, validation: g.validation, draft: false });
    const pdfHash = await sha256Bytes(pdfBytes);
    const pdfUrl = await store(ctx.base44, pdfBytes, `${report.report_ref}.pdf`, 'application/pdf');

    // Optional Didit file: never blocks the Vitauri generation.
    let didit = null;
    let diditError = '';
    if (ctx.tenant?.tm_settings?.fiu_didit_generation === true) {
      try { didit = await runDiditGeneration(ctx, report, fiu, client, tmCase); } catch (e) { diditError = errText(e); }
    }

    await ctx.E.FiuReport.update(report.id, {
      status: 'generated', generation_error: diditError ? `Vitauri files generated; Didit file failed: ${diditError}` : '', generation_path_missing: false,
      ...(didit?.diditId ? { didit_report_id: didit.diditId } : {}),
      generated: { at, file_url: fileUrl, file_hash: xmlHash, pdf_url: pdfUrl, source: 'vitauri', pdf_hash: pdfHash, validation_warnings: g.validation.warnings.length, ...(didit ? { didit_file_url: didit.fileUrl, didit_file_hash: didit.hash } : {}) },
    });
    await audit('fiu_report_generated', { status: 'approved' }, { status: 'generated', source: 'vitauri', file_hash: xmlHash, pdf_hash: pdfHash, transactions: g.transactions, warnings: g.validation.warnings.length, didit: didit ? 'generated' : diditError ? 'failed' : 'off' },
      `goAML XML and PDF generated in Vitauri for ${report.report_ref} by ${ctx.auth.actorName} (XML SHA-256 ${xmlHash.slice(0, 12)}…).`);
    await safeFileArtefacts(ctx, report, [
      { kind: 'goaml_xml', file_url: fileUrl, file_name: `${report.report_ref}.xml`, file_hash: xmlHash },
      { kind: 'report_pdf', file_url: pdfUrl, file_name: `${report.report_ref}.pdf`, file_hash: pdfHash },
      ...(didit ? [{ kind: 'goaml_xml', file_url: didit.fileUrl, file_name: `${report.report_ref}.didit.xml`, file_hash: didit.hash }] : []),
    ]);
    return { report_id: report.id, status: 'generated', file_hash: xmlHash, pdf_hash: pdfHash, has_pdf: true, warnings: g.validation.warnings, didit_error: diditError || undefined };
  } catch (e) {
    const msg = errText(e);
    await ctx.E.FiuReport.update(report.id, { generation_error: msg, generation_error_at: new Date().toISOString(), generation_path_missing: false });
    await audit('fiu_report_generation_failed', { status: 'approved' }, { status: 'approved', error: msg }, `goAML generation failed for ${report.report_ref}: ${msg}`);
    throw httpError(e?.status === 422 ? 422 : 502, `goAML generation failed: ${msg}`);
  }
}
