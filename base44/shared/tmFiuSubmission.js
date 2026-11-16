// FIU register rules of phase 7 (gap G24, spec test 9). Pure: no I/O.
// With the KYC + AML layout (tenant flag aml_nav_v2) a submission needs the FIU reference, and a receipt creates a
// restricted change-of-circumstances event. With the flag off the flow is unchanged.

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

/**
 * Change-of-circumstances finding for a report the FIU has received. Restricted: KYC-only users see the neutral text.
 * No amounts, indicators or narrative in the summary.
 */
export function outcomeFinding(report, tmCase, reference) {
  const ref = report.report_ref || report.id;
  return {
    type: 'tm_investigation_outcome', key: `fiu_received:${report.id}`, before: {}, restricted: true, source_label: 'Investigation',
    after: {
      fiu_report_id: report.id, fiu_report_ref: report.report_ref || null, fiu_reference: reference || null,
      ...(tmCase ? { tm_case_id: tmCase.id, tm_case_ref: tmCase.case_ref || null, tm_alert_ids: tmCase.alert_ids || [] } : {}),
      ...(report.kyc_case_id ? { kyc_case_id: report.kyc_case_id } : {}),
    },
    summary: `FIU report ${ref} was received by the FIU${tmCase ? ` (investigation ${tmCase.case_ref || tmCase.id})` : ''}. Review the KYC file and the expected profile.`,
  };
}

/** True when an event for the same investigation is still waiting for a response (then no second one is created). */
export function hasOpenEventForCase(triggers, tmCaseId) {
  if (!tmCaseId) return false;
  return (triggers || []).some((t) => t.status === 'proposed' && (t.after?.tm_case_id === tmCaseId || t.source_ref === `tm_case:${tmCaseId}`));
}

/**
 * Report type for a report that comes from a KYC review. Such a report has no transactions, so only the activity
 * report (SAR) fits; STR and UTR need at least one transaction. null when the FIU profile does not allow SAR.
 */
export function kycReportType(enabled) {
  return (enabled || []).includes('SAR') ? 'SAR' : null;
}

/** Does this sign-off decision ask for an FIU report draft? */
export const wantsKycReport = (action, reportingObligation) => ['decline', 'terminate'].includes(action) && reportingObligation === 'report_to_be_filed';
