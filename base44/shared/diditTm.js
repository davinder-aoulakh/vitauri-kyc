// Thin Didit Transaction Monitoring wrappers. Backend only: uses tenant.didit_api_key.

const BASE_URL = 'https://verification.didit.me';

// TODO verify against docs.didit.me/transaction-monitoring/rules
export const RULES_PATH = '/v3/transaction-monitoring/rules/';
export const RULE_PATH = (id) => `/v3/transaction-monitoring/rules/${id}/`;
export const RULE_BACKTEST_PATH = (id) => `/v3/transaction-monitoring/rules/${id}/backtest/`;

// TODO verify against docs.didit.me/console/case-management/fiu-reports
export const FIU_REPORTS_PATH = '/v3/fiu-reports/';
export const FIU_REPORT_PATH = (id) => `/v3/fiu-reports/${id}/`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function request(tenant, method, path, body) {
  const apiKey = tenant?.didit_api_key;
  if (!apiKey) throw { status: 400, detail: 'Didit API key not configured for tenant' };

  let last;
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(BASE_URL + path, {
      method,
      headers: { 'x-api-key': apiKey, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(15000),
    });
    const text = await res.text();
    let data;
    try { data = text ? JSON.parse(text) : null; } catch { data = text; }
    if (res.ok) return data;

    last = { status: res.status, detail: data };
    const transient = res.status === 429 || res.status >= 500;
    if (!transient || attempt === 2) throw last;
    await sleep(500 * 2 ** attempt);
  }
  throw last;
}

export const postTransaction = (tenant, body) => request(tenant, 'POST', '/v3/transactions/', body);
export const getTransaction = (tenant, id) => request(tenant, 'GET', `/v3/transactions/${encodeURIComponent(id)}/`);

export const upsertRule = (tenant, ruleJson, diditRuleId) =>
  diditRuleId
    ? request(tenant, 'PATCH', RULE_PATH(encodeURIComponent(diditRuleId)), ruleJson)
    : request(tenant, 'POST', RULES_PATH, ruleJson);

export const backtestRule = (tenant, diditRuleId, from, to) =>
  request(tenant, 'POST', RULE_BACKTEST_PATH(encodeURIComponent(diditRuleId)), { from, to });

export const createFiuReport = (tenant, payload) => request(tenant, 'POST', FIU_REPORTS_PATH, payload);
export const getFiuReport = (tenant, id) => request(tenant, 'GET', FIU_REPORT_PATH(encodeURIComponent(id)));