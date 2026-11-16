// Frontend copy of the tenant-settings readers in base44/shared/tmDetection.js and base44/shared/tmCaseGrouping.js
// (keep both in step). Only the settings readers live here: the detection algorithms stay backend-side, because
// they need the ledger helpers. Pure: no I/O.

const RISK_CLASSES = ['Low', 'Medium', 'High', 'PEP'];

const DETECTION_DEFAULTS = {
  enabled: false, // tm_settings.detection_in_vitauri
  structuring: { amount_min: 1750, amount_below: 2000, window_days: 7, senders_by_class: { Low: 5, Medium: 4, High: 3, PEP: 3 } },
  rapid: { window_hours: 48, min_ratio: 0.8, min_out_amount: 0, foreign_only: true, ignore_inbound_references: ['SALARIS', 'SALARY', 'LOON'] },
  profile_coc_mode: 'structural', // 'structural' (N months above the ceiling) | 'first_overrun'
  profile_coc_months: 2,
};

const CASE_GROUPINGS = ['one_open_per_customer', 'per_rule_customer'];

function settingsOf(tenant) {
  const s = tenant?.tm_settings;
  if (!s) return {};
  if (typeof s === 'string') { try { return JSON.parse(s) || {}; } catch { return {}; } }
  return typeof s === 'object' ? s : {};
}
const num = (v, d, { min = 0 } = {}) => (Number.isFinite(Number(v)) && v !== '' && v !== null && Number(v) >= min ? Number(v) : d);
const int = (v, d, min = 1) => (Number.isInteger(Number(v)) && Number(v) >= min ? Number(v) : d);

/** Effective detection settings for a tenant: defaults overlaid with tm_settings. */
export function detectionSettings(tenant) {
  const s = settingsOf(tenant);
  const d = s.detection && typeof s.detection === 'object' ? s.detection : {};
  const D = DETECTION_DEFAULTS;
  const st = d.structuring || {}; const rp = d.rapid || {};
  const senders = {};
  for (const c of RISK_CLASSES) senders[c] = int(st.senders_by_class?.[c], D.structuring.senders_by_class[c], 2);
  return {
    enabled: s.detection_in_vitauri === true,
    structuring: {
      amount_min: num(st.amount_min, D.structuring.amount_min), amount_below: num(st.amount_below, D.structuring.amount_below),
      window_days: int(st.window_days, D.structuring.window_days), senders_by_class: senders,
    },
    rapid: {
      window_hours: int(rp.window_hours, D.rapid.window_hours), min_ratio: num(rp.min_ratio, D.rapid.min_ratio, { min: 0.01 }),
      min_out_amount: num(rp.min_out_amount, D.rapid.min_out_amount), foreign_only: rp.foreign_only !== false,
      ignore_inbound_references: Array.isArray(rp.ignore_inbound_references) ? rp.ignore_inbound_references.map(String).filter(Boolean) : D.rapid.ignore_inbound_references,
    },
    profile_coc_mode: ['structural', 'first_overrun'].includes(s.profile_coc_mode) ? s.profile_coc_mode : D.profile_coc_mode,
    profile_coc_months: int(s.profile_coc_months, D.profile_coc_months),
  };
}

/** { case_grouping, auto_case_objective, auto_case_sanctions } with defaults (one per customer, no auto-create). */
export function caseGroupingSettings(tenant) {
  const s = settingsOf(tenant);
  return {
    case_grouping: CASE_GROUPINGS.includes(s.case_grouping) ? s.case_grouping : 'one_open_per_customer',
    auto_case_objective: s.auto_case_objective === true,
    auto_case_sanctions: s.auto_case_sanctions === true,
  };
}