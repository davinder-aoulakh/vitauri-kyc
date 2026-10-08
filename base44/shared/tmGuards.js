// Server-side guards for Transaction Monitoring.
// Keep TM_KEYS in sync with the "Transaction Monitoring (new)" group in src/lib/featureFlags.js.
export const TM_KEYS = [
  'tm_core',
  'tm_ingest_api',
  'tm_kyc_analysis',
  'tm_rules',
  'tm_fiu',
  'tm_quality',
];

function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

export function isTmEnabled(tenant, key) {
  const defaultValue = !TM_KEYS.includes(key);
  try {
    if (!tenant?.features_enabled) return defaultValue;
    const flags = typeof tenant.features_enabled === 'string'
      ? JSON.parse(tenant.features_enabled)
      : tenant.features_enabled;
    if (key in flags) return defaultValue ? flags[key] !== false : flags[key] === true;
    return defaultValue;
  } catch {
    return defaultValue;
  }
}

export function requireTmEnabled(tenant, key) {
  if (!isTmEnabled(tenant, key)) throw httpError(403, `Feature ${key} is not enabled`);
}

export function requireRole(user, allowedRoles) {
  const role = user?.app_role || user?.data?.app_role;
  if (!role || !allowedRoles?.includes(role)) throw httpError(403, 'Forbidden');
}

export function assertTenant(record, tenantId) {
  if (!record || !tenantId || record.tenant_id !== tenantId) throw httpError(404, 'Not found');
  return record;
}