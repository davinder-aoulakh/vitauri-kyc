// Role-based permission matrix for Vitauri KYC
// app_role drives ALL in-app permissions

export const APP_ROLES = [
  'Analyst',
  'QC Reviewer',
  'Compliance Officer',
  'Manager',
  'Director',
  'Compliance Admin',
  'Tenant Admin',
  'Vitauri Ops',
];

export const PERMISSIONS = {
  viewOwnCases:         ['Analyst', 'QC Reviewer', 'Compliance Officer', 'Manager', 'Director', 'Compliance Admin', 'Tenant Admin', 'Vitauri Ops'],
  viewAllTenantCases:   ['QC Reviewer', 'Compliance Officer', 'Manager', 'Director', 'Compliance Admin', 'Tenant Admin', 'Vitauri Ops'],
  createEditClient:     ['Analyst'],
  createRunCase:        ['Analyst'],
  qcFlag:               ['QC Reviewer'],
  approveMedium:        ['Manager', 'Director'],
  approveHighUnacceptable: ['Director'],
  tenantConfig:         ['Compliance Admin', 'Tenant Admin'],
  userManagement:       ['Tenant Admin'],
  crossTenantOps:       ['Vitauri Ops'],
  bulkActions:          ['Manager', 'Director', 'Compliance Admin', 'Tenant Admin'],
  exportData:           ['Manager', 'Director', 'Compliance Officer', 'Compliance Admin', 'Tenant Admin'],
  viewMIDashboard:      ['Manager', 'Director', 'Compliance Officer'],
  viewArchive:          ['Compliance Officer', 'Tenant Admin'],
  manageArchive:        ['Compliance Admin', 'Tenant Admin'],
};

export function hasPermission(userRole, permission) {
  if (!userRole || !permission) return false;
  return PERMISSIONS[permission]?.includes(userRole) ?? false;
}

export function isVitauriOps(userRole) {
  return userRole === 'Vitauri Ops';
}

export function canApproveRisk(userRole, riskClass) {
  if (!riskClass) return false;
  if (riskClass === 'Low') return true; // Self sign-off
  if (riskClass === 'Medium') return hasPermission(userRole, 'approveMedium');
  if (riskClass === 'High' || riskClass === 'Unacceptable') return hasPermission(userRole, 'approveHighUnacceptable');
  return false;
}