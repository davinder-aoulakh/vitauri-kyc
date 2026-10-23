// Route builders for KYC + TM objects. Use these instead of string literals so every link deep-links correctly.
const q = (params) => {
  const s = new URLSearchParams(Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== '')).toString();
  return s ? `?${s}` : '';
};

export const toClient = (id, tab) => `/client/${id}${q({ tab })}`;
export const toKycCase = (id, step) => `/case/${id}${q({ step })}`;
export const toAlert = (id) => `/tm/alerts${q({ alert: id })}`;
export const toAlerts = (filter) => `/tm/alerts${q({ filter })}`;
export const toTmCase = (id) => `/tm/case/${id}`;
export const toTmCases = () => '/tm/cases';
export const toReport = (id) => `/tm/report/${id}`;
export const toReports = () => '/tm/reports';
export const toRule = (id) => `/tm/rules${q({ rule: id })}`;
export const toCoverage = (accountId) => `/tm/coverage${q({ account: accountId })}`;
export const toWork = (section) => `/work${q({ section })}`;
export const toReviewPlanner = (filter) => `/review-planner${q({ filter })}`;

/** Route for a Notification row (all link_* fields), or null. */
export function notificationRoute(n) {
  if (!n) return null;
  if (n.link_fiu_report_id) return toReport(n.link_fiu_report_id);
  if (n.link_tm_case_id) return toTmCase(n.link_tm_case_id);
  if (n.link_alert_id) return toAlert(n.link_alert_id);
  if (n.link_kyc_case_id) return toKycCase(n.link_kyc_case_id);
  if (n.link_case_id) return toKycCase(n.link_case_id);
  if (n.link_client_id) return toClient(n.link_client_id);
  return null;
}
