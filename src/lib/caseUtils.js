/**
 * Single source of truth for reading KYC case step status.
 * Use these everywhere instead of direct kycCase[`step_${id}_status`] access.
 */

// Steps that can be marked as not required
const NOT_REQUIRED_STEPS = [2, 5, 7];

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
    // Step 2 — IDV: ORG uses KYB/company registry, not personal Didit IDV
    step_2_not_required: isORG,

    // Step 5 — SoF/Wealth: required for everyone at creation; analyst can waive after risk assessment
    step_5_not_required: false,

    // Step 7 — Control Measures: required for everyone; analyst can waive if Acceptable risk outcome
    step_7_not_required: false,
  };
}