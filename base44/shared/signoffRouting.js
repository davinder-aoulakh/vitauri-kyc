// Sign-off routing and permissions (build spec §3–§4). Pure. Mirrored verbatim in src/lib/signoffRouting.js — keep in sync.
//
// Role mapping (Vitauri -> spec): Analyst/QC Reviewer = Analyst · Manager = Manager · Director = Senior Management ·
// Compliance Officer/Compliance Admin = Compliance · Tenant Admin may act in any role. Independence and four-eyes are
// enforced per PERSON: whoever submitted (prepared) or gave Compliance advice can never approve that case.

export const RANK = { Low: 1, Medium: 2, High: 3, Unacceptable: 4 };
export const CLASSES = ['Low', 'Medium', 'High', 'Unacceptable'];
export const LEVELS = ['analyst', 'manager', 'senior'];
export const LEVEL_LABEL = { analyst: 'Analyst (self sign-off)', manager: 'Manager', senior: 'Senior Management' };

export const ANALYST_ROLES = ['Analyst', 'QC Reviewer', 'Compliance Officer', 'Manager', 'Director', 'Compliance Admin', 'Tenant Admin']; // createRunCase
export const COMPLIANCE_ROLES = ['Compliance Officer', 'Compliance Admin', 'Tenant Admin'];
export const APPROVER_ROLES = { analyst: ANALYST_ROLES, manager: ['Manager', 'Director', 'Tenant Admin'], senior: ['Director', 'Tenant Admin'] };
export const ESCALATE_ROLES = ['Manager', 'Tenant Admin'];
export const OVERRIDE_VALUES = ['auto', 'analyst', 'manager', 'senior', 'senior_advice'];

const norm = (c) => (RANK[c] ? c : null);
const maxClass = (a, b) => (!a ? b : !b ? a : RANK[a] >= RANK[b] ? a : b);

/** Tenant sign-off settings with defaults. Accepts the legacy per-class matrix ({ Low: {approver, compliance_mandatory}, … }). */
export function signoffConfig(tenant) {
  const m = tenant?.sign_off_matrix || {};
  return {
    compliance_advice_enabled: m.compliance_advice_enabled !== false,
    highest_of_existing_and_proposed: m.highest_of_existing_and_proposed !== false,
    low_risk_mode: m.low_risk_mode === 'automatic' ? 'automatic' : 'self',
    overrides: m.overrides && typeof m.overrides === 'object' ? m.overrides : {},
    qc_strictness: { Low: 'light', Medium: 'light', High: 'strict', Unacceptable: 'strict', ...(m.qc_strictness || {}) },
    advice_template_headings: Array.isArray(m.advice_template_headings) && m.advice_template_headings.length
      ? m.advice_template_headings : ['Assessment', 'Risks', 'Mitigating measures', 'Conclusion'],
    legacy: Object.fromEntries(CLASSES.map((c) => [c, m[c] || null])),
  };
}

const LEGACY_LEVEL = { Analyst: 'analyst', 'QC Reviewer': 'analyst', Manager: 'manager', Director: 'senior', 'Compliance Admin': 'senior', 'Compliance Officer': 'senior' };
const DEFAULT_LEVEL = { Low: 'analyst', Medium: 'manager', High: 'senior', Unacceptable: 'senior' };

/**
 * Spec §4. caseLike: { existing_classification, proposed_classification | risk_classification, previously_declined }.
 * Returns { existing, proposed, effective, level, needsAdvice, isDowngrade, reason, approverRoles, override, selfSignOff }.
 */
export function resolveRoute(caseLike, tenantOrConfig) {
  const cfg = tenantOrConfig?.overrides !== undefined && tenantOrConfig?.legacy ? tenantOrConfig : signoffConfig(tenantOrConfig);
  const existing = norm(caseLike?.existing_classification);
  const proposed = norm(caseLike?.proposed_classification || caseLike?.risk_classification);
  if (!proposed) {
    return { existing, proposed: null, effective: null, level: null, needsAdvice: false, isDowngrade: false, approverRoles: [], selfSignOff: false,
      reason: 'No risk classification yet. Finish the Risk Assessment first.' };
  }
  let effective = proposed;
  if (cfg.highest_of_existing_and_proposed && existing) effective = maxClass(existing, proposed);

  let level = DEFAULT_LEVEL[effective];
  let needsAdvice = cfg.compliance_advice_enabled && RANK[effective] >= RANK.High;
  const why = [];
  why.push(effective === proposed ? `the classification is ${effective}` : `the classification stays ${effective} (existing ${existing}, proposed ${proposed})`);

  // Legacy per-class matrix (tab "Sign-Off Matrix" before this change): a non-default approver or "compliance mandatory".
  const legacy = cfg.legacy?.[effective];
  if (legacy?.approver && LEGACY_LEVEL[legacy.approver] && LEGACY_LEVEL[legacy.approver] !== DEFAULT_LEVEL[effective]) {
    level = LEGACY_LEVEL[legacy.approver]; why.push(`tenant matrix sets ${legacy.approver}`);
  }
  if (legacy?.compliance_mandatory && cfg.compliance_advice_enabled && !needsAdvice) { needsAdvice = true; why.push('tenant matrix requires Compliance advice'); }

  const key = `${existing || 'New'}|${proposed}`;
  const ov = cfg.overrides[key];
  if (ov && ov !== 'auto' && OVERRIDE_VALUES.includes(ov)) {
    level = ov === 'senior_advice' ? 'senior' : ov;
    needsAdvice = ov === 'senior_advice' ? cfg.compliance_advice_enabled : (ov === 'senior' ? needsAdvice : false);
    why.push(`tenant override ${existing || 'New'} → ${proposed}`);
  }
  if (effective === 'Unacceptable') level = 'senior'; // never below Senior Management
  if (caseLike?.previously_declined) { needsAdvice = cfg.compliance_advice_enabled || true; if (level === 'analyst') level = 'manager'; why.push('the client was previously declined'); }

  const isDowngrade = !!existing && RANK[existing] > RANK[proposed];
  const selfSignOff = level === 'analyst';
  return {
    existing, proposed, effective, level, needsAdvice, isDowngrade, selfSignOff, override: ov && ov !== 'auto' ? ov : null,
    approverRoles: APPROVER_ROLES[level],
    reason: `Route: ${LEVEL_LABEL[level]}, because ${why.join('; ')}. ${needsAdvice ? 'Compliance advice is required first.' : 'Compliance advice is not required.'}`,
  };
}

const roleOf = (u) => u?.app_role || u?.data?.app_role;

/** What this user may do on this case (spec §3, per-person independence). */
export function signoffPermissions(user, kycCase, route, advice) {
  const role = roleOf(user);
  const uid = user?.id;
  const submitter = kycCase?.sign_off_submitted_by || null;
  const adviser = advice?.status === 'received' || advice?.status === 'outdated' ? advice?.given_by : null;
  const isAnalyst = ANALYST_ROLES.includes(role);
  const isCompliance = COMPLIANCE_ROLES.includes(role);
  const level = route?.level;
  const approverRole = !!level && APPROVER_ROLES[level].includes(role);
  // Four-eyes: above analyst level the submitter may not approve. Independence: the adviser may never approve.
  const blockedFourEyes = level !== 'analyst' && !!submitter && submitter === uid;
  const blockedAdviser = !!adviser && adviser === uid;
  // Compliance Officer / Compliance Admin are Compliance, never approvers (Tenant Admin may be either, per person).
  const complianceOnly = isCompliance && role !== 'Tenant Admin';
  return {
    role,
    canSubmit: isAnalyst,
    canGiveAdvice: isCompliance && (!submitter || submitter !== uid),
    canApprove: approverRole && !complianceOnly && !blockedFourEyes && !blockedAdviser,
    canEscalate: level === 'manager' && ESCALATE_ROLES.includes(role) && !blockedFourEyes && !blockedAdviser,
    canReturn: approverRole && !complianceOnly && !blockedAdviser,
    canReopen: ['Director', 'Tenant Admin'].includes(role),
    blockedFourEyes, blockedAdviser, complianceOnly,
  };
}
