// Frontend copy of base44/shared/tmFiuSubmission.js (keep both in step).
// FIU register rules of phase 7 (gap G24, spec test 9). Pure: no I/O.

export const SUBMISSION_METHODS = ['portal_upload', 'xml_upload', 'm2m'];

/** aml_nav_v2 is a default-off flag; isTmEnabled treats unknown keys as on, so it has its own reader. */
export function amlV2On(tenant) {
  let f = tenant?.features_enabled;
  if (typeof f === 'string') { try { f = JSON.parse(f); } catch { f = null; } }
  return !!f && f.aml_nav_v2 === true;
}

const clean = (v) => String(v ?? '').trim();

/** { error } or { method, evidence, reference } for the 'submitted' action. */
export function submissionCheck(body, { v2 } = {}) {
  if (!SUBMISSION_METHODS.includes(body?.method)) return { error: 'method must be portal_upload, xml_upload or m2m' };
  const evidence = clean(body?.evidence_file);
  if (!evidence) return { error: 'Evidence of the submission is required' };
  const reference = clean(body?.fiu_reference).slice(0, 200);
  if (v2 && !reference) return { error: 'The FIU reference is required to record a submission' };
  return { method: body.method, evidence, reference: reference || null };
}

/** The reference for a receipt: the one given now, else the one recorded at submission. '' when neither exists. */
export const receiptReference = (report, body) => clean(body?.fiu_reference).slice(0, 200) || clean(report?.submitted?.fiu_reference);

/** The reference to show for a report, whatever its stage. */
export const referenceOf = (report) => clean(report?.received?.fiu_reference) || clean(report?.submitted?.fiu_reference) || '';