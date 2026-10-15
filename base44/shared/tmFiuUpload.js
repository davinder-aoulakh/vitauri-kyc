// Manual fallback for FIU reports: a Compliance Officer uploads the goAML XML generated in the Didit console.
import { XMLValidator } from 'npm:fast-xml-parser@4.4.1';
import { httpError } from './tmAuth.js';
import { writeAudit } from './tmAudit.js';

const MAX_CHARS = 5_000_000;

async function sha256Bytes(bytes) {
  const buf = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function uploadGenerated(ctx, report, { xml_text, filename }) {
  if (report.status !== 'approved') throw httpError(409, 'Only an approved report can take an uploaded goAML file');
  const text = String(xml_text ?? '').replace(/^\uFEFF/, '');
  if (!text.trim()) throw httpError(400, 'The XML file is empty');
  if (text.length > MAX_CHARS) throw httpError(413, 'The XML file is too large');
  if (!text.trimStart().startsWith('<')) throw httpError(422, 'The file does not start with "<", so it is not XML');
  if (/<!DOCTYPE|<!ENTITY/i.test(text)) throw httpError(422, 'XML with a DOCTYPE or entity declarations is not accepted');
  const valid = XMLValidator.validate(text);
  if (valid !== true) throw httpError(422, `The file is not valid XML: ${String(valid?.err?.msg || 'parse error').slice(0, 150)}`);

  const bytes = new TextEncoder().encode(text);
  const hash = await sha256Bytes(bytes);
  const up = await ctx.base44.asServiceRole.integrations.Core.UploadPrivateFile({ file: new File([bytes], `${report.report_ref}.xml`, { type: 'application/xml' }) });
  if (!up?.file_uri) throw httpError(502, 'The file could not be stored');

  const at = new Date().toISOString();
  await ctx.E.FiuReport.update(report.id, {
    status: 'generated', generation_error: '', generation_path_missing: false,
    generated: { at, file_url: up.file_uri, file_hash: hash, source: 'manual_upload' },
  });
  await writeAudit(ctx.base44, ctx.auth, {
    tenantId: ctx.tenantId, clientId: report.client_id, eventType: 'fiu_report_goaml_uploaded',
    before: { status: 'approved' }, after: { status: 'generated', file_hash: hash, source: 'manual_upload', original_name: String(filename || '').slice(0, 120) },
    notes: `goAML XML for ${report.report_ref} uploaded manually by ${ctx.auth.actorName} (generated in the Didit console).`,
  });
  return { report_id: report.id, status: 'generated', file_hash: hash };
}