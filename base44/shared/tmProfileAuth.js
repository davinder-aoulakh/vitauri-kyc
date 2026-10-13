// Who may approve/reject an ExpectedProfile. Mirrors src/lib/profileApproval.js (keep in sync).
const DEFAULT_APPROVER = { Low: 'Analyst', Medium: 'Manager', High: 'Director', Unacceptable: 'Director' };
const WORK_ROLES = ['Analyst', 'QC Reviewer', 'Compliance Officer', 'Manager'];

export function matrixApprover(tenant, risk) {
  let m = tenant?.sign_off_matrix;
  if (typeof m === 'string') { try { m = JSON.parse(m); } catch { m = null; } }
  return m?.[risk]?.approver || DEFAULT_APPROVER[risk] || 'Manager';
}

export function canDecideProfile({ role, userId, tenant, riskClass, proposedBy }) {
  const risk = riskClass || 'Medium';
  const approver = matrixApprover(tenant, risk);
  let roleOk = role === approver;
  if (risk === 'Low') roleOk = roleOk || ['Manager', 'Director'].includes(role) || (approver === 'Analyst' && WORK_ROLES.includes(role));
  if (risk === 'Medium') roleOk = roleOk || ['Manager', 'Director'].includes(role);
  if (risk === 'High' || risk === 'Unacceptable') roleOk = roleOk || role === 'Director';
  if (!roleOk) return { allowed: false, reason: `Requires ${approver} (or above) for ${risk} risk clients` };
  const selfOk = risk === 'Low' && approver === 'Analyst';
  if (!selfOk && proposedBy && proposedBy === userId) return { allowed: false, reason: 'Approver must differ from the proposer' };
  return { allowed: true };
}