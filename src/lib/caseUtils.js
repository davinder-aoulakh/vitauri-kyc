/**
 * Single source of truth for reading KYC case step status.
 * Use these everywhere instead of direct kycCase[`step_${id}_status`] access.
 */

// Steps that can be marked as not required
// Step 2 removed — Didit now covers both NP and ORG, so it is always required
const NOT_REQUIRED_STEPS = [5, 7, 11];

const CLOSED = ['Approved', 'Rejected', 'Closed'];
/**
 * 2 = Draft Report & QC (id 10) → Compliance Advice (id 11) → Final Report & Sign-off (id 8).
 * Legacy (1) = closed cases from before the change, which keep their 8-step view. Open cases always use the new flow.
 */
export function caseFlowVersion(kycCase) {
  if (kycCase?.signoff_flow === 2) return 2;
  return CLOSED.includes(kycCase?.status) ? 1 : 2;
}

export function getStepStatus(kycCase, stepId) {
  if (NOT_REQUIRED_STEPS.includes(stepId) && kycCase?.[`step_${stepId}_not_required`] === true) {
    return 'not_required';
  }
  const key = `step_${stepId}_status`;
  return kycCase?.[key] || 'not_started';
}

export function isStepComplete(kycCase, stepId) {
  const s = getStepStatus(kycCase, stepId);
  // not_required counts as complete for case completion purposes
  return s === 'complete' || s === 'not_required';
}

export function isStepNotRequired(kycCase, stepId) {
  return getStepStatus(kycCase, stepId) === 'not_required';
}

/**
 * Returns default not_required flags for a new case based on client and case type.
 * Steps 2, 5, 7 are the only ones that can be not_required.
 */
export function getDefaultStepConfig(clientType, caseType) {
  const isORG = clientType === 'ORG';

  return {
    // Step 2 — Didit handles both NP and ORG verification
    step_2_not_required: false,

    // Step 5 — SoF/Wealth: required for everyone at creation; analyst can waive after risk assessment
    step_5_not_required: false,

    // Step 7 — Control Measures: required for everyone; analyst can waive if Acceptable risk outcome
    step_7_not_required: false,
  };
}