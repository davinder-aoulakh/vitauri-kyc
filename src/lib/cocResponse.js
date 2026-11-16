// Frontend copy of base44/shared/cocResponse.js (keep both in step).
// Change of circumstances: the graduated response to an event (phase 5, gaps G17-G19). Pure: no I/O.
// An event (EdrTrigger) gets one of four responses; only the steps the event touches are re-run in the review.

export const RESPONSES = ['no_action', 'targeted_check', 'risk_reassessment', 'full_cdd_refresh'];
export const RESPONSE_LABEL = {
  no_action: 'No action',
  targeted_check: 'Targeted check',
  risk_reassessment: 'Risk reassessment',
  full_cdd_refresh: 'Full CDD refresh',
};
export const RESPONSE_HELP = {
  no_action: 'Close the event with a reason. No review is opened.',
  targeted_check: 'Open a review that re-runs only the steps this event touches.',
  risk_reassessment: 'As a targeted check, and always re-run Risk assessment and Control measures.',
  full_cdd_refresh: 'Open a review that re-runs every step.',
};

/** Labels for EdrTrigger.status on the Change of circumstances page. */
export const STATUS_LABEL = { proposed: 'Awaiting response', accepted: 'Review started', dismissed: 'Closed' };

export const REVIEW_STEPS = [1, 2, 3, 4, 5, 6, 7];
export const STEP_LABEL = {
  1: 'Outreach & documents', 2: 'Verification', 3: 'Screening', 4: 'Client profile',
  5: 'Source of funds', 6: 'Risk assessment', 7: 'Control measures',
};

// PROVISIONAL: which steps an event touches. Starting values (plan phase 5); to be confirmed by Compliance.
export const AFFECTED_STEPS = {
  screening_hit: [3, 6],
  profile_breach: [4, 5, 6],
  ubo_change: [1, 2, 3, 6],
  director_change: [1, 2, 3, 6],
  business_activity_change: [4, 6],
  country_change: [3, 4, 6],
  id_expiry: [1, 2],
  address_change: [1, 4],
  tm_alert_frequency: [4, 5, 6],
  tm_new_country: [4, 5, 6],
  tm_investigation_outcome: [4, 5, 6],
  tm_case: [4, 5, 6],
  risk_band_rise: [6, 7],
  transaction_verification: [4, 5, 6],
};

const sorted = (arr) => [...new Set(arr)].sort((a, b) => a - b);

/**
 * What a response means for the review.
 * Returns { createsReview, required: [step ids], flags: { step_N_not_required } }.
 * An unknown event type is treated as touching every step. Sign-off steps are never skipped.
 */
export function stepsForResponse(triggerType, response) {
  if (!RESPONSES.includes(response)) throw new Error(`Unknown response: ${response}`);
  if (response === 'no_action') return { createsReview: false, required: [], flags: {} };
  const affected = AFFECTED_STEPS[triggerType] || REVIEW_STEPS;
  let required = REVIEW_STEPS;
  if (response === 'targeted_check') required = sorted(affected);
  if (response === 'risk_reassessment') required = sorted([...affected, 6, 7]);
  const flags = {};
  for (const n of REVIEW_STEPS) flags[`step_${n}_not_required`] = !required.includes(n);
  return { createsReview: true, required, flags };
}

// Steps that can only be skipped in a review opened by a response (5 and 7 can also be waived by the analyst).
const DELTA_ONLY = [1, 2, 3, 4, 6];
/** True when this step is left out of a review that was opened by a graduated response. */
export const deltaSkipped = (kycCase, stepId) =>
  !!kycCase?.delta_response && DELTA_ONLY.includes(Number(stepId)) && kycCase[`step_${stepId}_not_required`] === true;

// ── Screening page ──
const SCREENING_TYPES = new Set(['Screening_Hit', 'Manual_Flag', 'Didit_Ongoing_PEP', 'Didit_Ongoing_Sanctions', 'Didit_Ongoing_Adverse_Media', 'Didit_Ongoing_High_Risk']);
/** Alerts that ask "is it this person?". Register changes, abandoned verifications and TM mirrors are other signals. */
export const isScreeningAlert = (alert) => SCREENING_TYPES.has(alert?.alert_type);
export const isSanctionsAlert = (alert) => alert?.alert_type === 'Didit_Ongoing_Sanctions' || /^sanctions/i.test(alert?.source || '');

/** ScreeningHit.source for a monitoring alert (the hit record has a fixed list of sources). */
export function hitSourceFor(alert) {
  const src = String(alert?.source || '');
  if (['PEP_List', 'Sanctions_EU', 'Sanctions_UN', 'Adverse_Media', 'Internal_Flag'].includes(src)) return src;
  if (alert?.alert_type === 'Didit_Ongoing_PEP') return 'PEP_List';
  if (alert?.alert_type === 'Didit_Ongoing_Sanctions') return 'Sanctions_EU';
  if (alert?.alert_type === 'Didit_Ongoing_Adverse_Media') return 'Adverse_Media';
  return 'Internal_Flag';
}

// ── Restricted events ──
export const RESTRICTED_TEXT = 'AML outcome requires a review · details restricted to AML and Compliance';

/** The event as a user may see it: a restricted event keeps its type, dates and status, and loses its details. */
export function maskTrigger(trigger, mayseeAml) {
  if (!trigger?.restricted || mayseeAml) return { ...trigger, masked: false };
  return {
    id: trigger.id, tenant_id: trigger.tenant_id, client_id: trigger.client_id, status: trigger.status,
    trigger_type: trigger.trigger_type, created_date: trigger.created_date, decided_at: trigger.decided_at,
    kyc_case_id: trigger.kyc_case_id, response: trigger.response, restricted: true, masked: true,
    source_label: 'AML', before: {}, after: { summary: RESTRICTED_TEXT },
  };
}