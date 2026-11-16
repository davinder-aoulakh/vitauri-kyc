// Frontend copy of base44/shared/workDomain.js (keep both in step). Need-to-know between KYC and AML work
// (phase 6, decision D6, spec section 4). Pure: no I/O.
// A tenant chooses a role model: 'combined' (default: every analyst does both) or 'separate'.
// In the separate model a user's work_domain ('kyc' | 'aml' | 'both') decides which side they see.
// Compliance and admin roles always see both sides, whatever their work_domain.

export const ROLE_MODELS = ['combined', 'separate'];
export const WORK_DOMAINS = ['both', 'kyc', 'aml'];
export const WORK_DOMAIN_LABEL = { both: 'KYC and AML', kyc: 'KYC only', aml: 'AML only' };
export const ALWAYS_BOTH_ROLES = ['Compliance Officer', 'Compliance Admin', 'Tenant Admin', 'Vitauri Ops'];

function settingsOf(tenant) {
  const s = tenant?.tm_settings;
  if (!s) return {};
  if (typeof s === 'string') { try { return JSON.parse(s) || {}; } catch { return {}; } }
  return typeof s === 'object' ? s : {};
}

export const roleModel = (tenant) => (settingsOf(tenant).role_model === 'separate' ? 'separate' : 'combined');
export const roleOfUser = (user) => user?.app_role || user?.data?.app_role || null;

/** 'both' | 'kyc' | 'aml'. A missing or unknown value is 'both', so nothing changes until a user is set. */
export function domainOf(user) {
  const d = user?.work_domain || user?.data?.work_domain;
  return WORK_DOMAINS.includes(d) ? d : 'both';
}

function allowed(user, tenant, side) {
  if (roleModel(tenant) !== 'separate') return true;
  if (ALWAYS_BOTH_ROLES.includes(roleOfUser(user))) return true;
  const d = domainOf(user);
  return d === 'both' || d === side;
}

/** May see alerts, investigations, FIU reports and transaction-monitoring detail. */
export const canAml = (user, tenant) => allowed(user, tenant, 'aml');
/** May see the KYC group (reviews, screening, change of circumstances, outreach). */
export const canKyc = (user, tenant) => allowed(user, tenant, 'kyc');