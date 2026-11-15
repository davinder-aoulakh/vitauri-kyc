// Alerts → investigations (phase 4). Pure: no I/O.
// Escalating an alert adds it to the open investigation it belongs to, or starts one; which one is a tenant setting
// (spec: "default one open investigation per customer, configurable per rule").

export const CASE_GROUPINGS = ['one_open_per_customer', 'per_rule_customer'];
export const CASE_OUTCOMES = ['reported_to_fiu', 'no_report_explained', 'true_positive_no_report'];
export const OUTCOME_LABEL = {
  reported_to_fiu: 'Reported to the FIU',
  no_report_explained: 'No report: activity explained',
  true_positive_no_report: 'True positive, motivated decision not to report',
};
const OPEN_CASE = ['open', 'investigating', 'pending_co'];

function settingsOf(tenant) {
  const s = tenant?.tm_settings;
  if (!s) return {};
  if (typeof s === 'string') { try { return JSON.parse(s) || {}; } catch { return {}; } }
  return typeof s === 'object' ? s : {};
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

/** What "the same rule" means for an alert: its scenario, else its first rule, else its source. */
export function ruleKeyOf(alert) {
  return String(alert?.scenario_id || (alert?.rule_ids || [])[0] || alert?.source || 'alert');
}

/** grouping_key stored on a case that was started by an escalation in per-rule mode. */
export const groupingKeyFor = (alert, mode) => (mode === 'per_rule_customer' ? `${alert.client_id}:${ruleKeyOf(alert)}` : `${alert.client_id}`);

/**
 * The open investigation this alert belongs to, or null (then a new one is started).
 * Only investigations whose primary customer is the alert's customer are considered; network investigations
 * (started from another case) are never joined automatically. The oldest matching one wins.
 */
export function pickCase(openCases, alert, mode) {
  const mine = (openCases || [])
    .filter((c) => OPEN_CASE.includes(c.status) && c.primary_client_id === alert.client_id && !c.network_origin_case_id)
    .sort((a, b) => String(a.created_date || '').localeCompare(String(b.created_date || '')));
  if (mode !== 'per_rule_customer') return mine[0] || null;
  const key = groupingKeyFor(alert, mode);
  return mine.find((c) => c.grouping_key === key) || null;
}

/** Outcome stored on the case for a Compliance Officer decision (gap G16). */
export function outcomeFor(decision, requested) {
  if (decision === 'report') return 'reported_to_fiu';
  return requested === 'true_positive_no_report' ? 'true_positive_no_report' : 'no_report_explained';
}

/** Did the analyst follow the AI proposal? null when there was none or it did not point to an action. */
export function aiFollowed(aiProposal, action) {
  if (!['escalate', 'close'].includes(aiProposal) || !['escalate', 'close'].includes(action)) return null;
  return aiProposal === action;
}

/** Should a case be started automatically for a newly created alert? Returns a reason string or ''. */
export function autoCaseReason(alert, settings) {
  if (settings.auto_case_objective && alert?.indicator_type === 'objective') return 'objective indicator';
  return '';
}
