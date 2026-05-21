/**
 * Single source of truth for reading KYC case step status.
 * Use these everywhere instead of direct kycCase[`step_${id}_status`] access.
 */

export function getStepStatus(kycCase, stepId) {
  const key = `step_${stepId}_status`;
  return kycCase?.[key] || 'not_started';
}

export function isStepComplete(kycCase, stepId) {
  return getStepStatus(kycCase, stepId) === 'complete';
}