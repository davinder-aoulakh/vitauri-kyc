// Generates the goAML file for an approved FIU report through Didit. Never fabricates a file.
import { asList, httpError } from './tmAuth.js';
import { writeAudit } from './tmAudit.js';
import { createDiditCase, createFiuReport, getFiuReport, downloadBinary } from './diditTm.js';
import { loadRefs } from './tmFiuChecks.js';
import { safeFileArtefacts } from './tmFiuArtefacts.js';

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

async function sha256Bytes(bytes) {
  const buf = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function store(base44, bytes, name, type) {
  const up = await base44.asServiceRole.integrations.Core.UploadPrivateFile({ file: new File([bytes], name, { type }) });
  if (!up?.file_uri) throw new Error('The file could not be stored');
  return up.file_uri;
}

async function ensureDiditCase(ctx, tmCase, client) {
  if (tmCase?.didit_case_id) return tmCase.didit_case_id;
  const created = await createDiditCase(ctx.tenant, { vendor_data: client.id, name: `${client.full_name} · ${tmCase?.case_ref || 'FIU report'}` });
  const id = created?.id || created?.uuid || created?.case_id;
  if (!id) throw { detail: 'Didit did not return a case id' };
  if (tmCase) await ctx.E.TmCase.update(tmCase.id, { didit_case_id: id });
  return id;
}

async function runGeneration(ctx, report, fiu, client, tmCase) {
  const template = fiu.didit_template_ids?.[report.type] || fiu.didit_template_ids?.[report.type === 'unusual_objective' ? 'objective' : 'subjective'];
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
  if (!xmlRef && !inlineXml) throw { detail: 'Didit has not returned a goAML XML file yet. Try again shortly.' };
  const xml = inlineXml || await downloadBinary(ctx.tenant, xmlRef);
  if (!new TextDecoder().decode(xml.slice(0, 200)).trim().startsWith('<')) throw { detail: 'The downloaded file is not XML' };
  const pdfRef = pick(res, PDF_KEYS);
  const pdf = pdfRef ? await downloadBinary(ctx.tenant, pdfRef).catch(() => null) : null;
  const fileUrl = await store(ctx.base44, xml, `${report.report_ref}.xml`, 'application/xml');
  const pdfUrl = pdf ? await store(ctx.base44, pdf, `${report.report_ref}.pdf`, 'application/pdf') : undefined;
  return { diditId, fileUrl, pdfUrl, hash: await sha256Bytes(xml) };
}

export async function generateReport(ctx, report) {
  if (report.status !== 'approved') throw httpError(409, 'Only an approved report can be generated');
  const { fiu, client, tmCase } = await loadRefs(ctx, report);
  if (!fiu) throw httpError(404, `No ${report.fiu_profile_code} FIU profile is configured`);
  const audit = (eventType, before, after, notes) => writeAudit(ctx.base44, ctx.auth, { tenantId: ctx.tenantId, clientId: report.client_id, eventType, before, after, notes });
  try {
    const g = await runGeneration(ctx, report, fiu, client, tmCase);
    const at = new Date().toISOString();
    await ctx.E.FiuReport.update(report.id, {
      status: 'generated', didit_report_id: g.diditId || undefined, generation_error: '', generation_path_missing: false,
      generated: { at, file_url: g.fileUrl, file_hash: g.hash, ...(g.pdfUrl ? { pdf_url: g.pdfUrl } : {}) },
    });
    await audit('fiu_report_generated', { status: 'approved' }, { status: 'generated', file_hash: g.hash, pdf: !!g.pdfUrl }, `goAML file generated for ${report.report_ref} by ${ctx.auth.actorName}.`);
    await safeFileArtefacts(ctx, report, [
      { kind: 'goaml_xml', file_url: g.fileUrl, file_name: `${report.report_ref}.xml`, file_hash: g.hash },
      ...(g.pdfUrl ? [{ kind: 'report_pdf', file_url: g.pdfUrl, file_name: `${report.report_ref}.pdf` }] : []),
    ]);
    return { report_id: report.id, status: 'generated', file_hash: g.hash, has_pdf: !!g.pdfUrl };
  } catch (e) {
    const msg = errText(e);
    await ctx.E.FiuReport.update(report.id, { generation_error: msg, generation_error_at: new Date().toISOString(), generation_path_missing: e?.status === 404 || e?.status === 405 });
    await audit('fiu_report_generation_failed', { status: 'approved' }, { status: 'approved', error: msg }, `goAML generation failed for ${report.report_ref}: ${msg}`);
    throw httpError(502, `goAML generation failed: ${msg}`);
  }
}