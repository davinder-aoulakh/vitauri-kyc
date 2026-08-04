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