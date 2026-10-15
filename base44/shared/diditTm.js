// Thin Didit Transaction Monitoring wrappers. Backend only: uses tenant.didit_api_key.

const BASE_URL = 'https://verification.didit.me';
const enc = encodeURIComponent;

// Every Didit TM path lives here. A tenant can override any key with tm_settings.didit_paths, e.g.
//   { "fiuReports": "/v3/fiu/reports/", "fiuReport": "/v3/fiu/reports/{id}/", "userCustomProperties": "/v3/users/{vendorData}/" }
// Function-valued keys take a string with {id} / {vendorData} placeholders.
// Endpoint status: the Vitauri Ops "Run check" on /ops/tm-regression (function diditEndpointCheck) probes these paths per Demo tenant.
export const DIDIT_TM_PATHS = {
  transactions: '/v3/transactions/',
  transaction: (id) => `/v3/transactions/${enc(id)}/`,
  rules: '/v3/transactions/rules/',
  rule: (id) => `/v3/transactions/rules/${enc(id)}/`,
  ruleBacktest: '/v3/transactions/rules/backtest/',
  userCustomProperties: (vendorData) => `/v3/users/${enc(vendorData)}/`,
  fiuReports: '/v3/fiu-reports/',
  fiuReport: (id) => `/v3/fiu-reports/${enc(id)}/`,
  cases: '/v3/cases/',
};

/** Resolves a path for a tenant: tenant.tm_settings.didit_paths[key] wins, else the default. */
export function tmPath(tenant, key, arg) {
  const def = DIDIT_TM_PATHS[key];
  const override = tenant?.tm_settings?.didit_paths?.[key];
  if (typeof override === 'string' && override.startsWith('/')) {
    return typeof def === 'function' ? override.split('{id}').join(enc(arg)).split('{vendorData}').join(enc(arg)) : override;
  }
  return typeof def === 'function' ? def(arg) : def;
}

/** True when Didit answered 404/405: the path (or method) does not exist for this plan. */
export const isPathMissing = (e) => e?.status === 404 || e?.status === 405;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function request(tenant, method, path, body) {
  const apiKey = tenant?.didit_api_key;
  if (!apiKey) throw { status: 412, detail: 'Didit credentials not found — check TenantSecret' };

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

/** Single attempt, never throws on an HTTP status. Returns { status } (0 = network error / timeout). Used by diditEndpointCheck only. */
export async function probe(tenant, method, path, body) {
  const apiKey = tenant?.didit_api_key;
  if (!apiKey) throw { status: 412, detail: 'Didit credentials not found — check TenantSecret' };
  try {
    const res = await fetch(BASE_URL + path, {
      method,
      headers: { 'x-api-key': apiKey, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(15000),
    });
    await res.text().catch(() => '');
    return { status: res.status };
  } catch (e) {
    return { status: 0, error: e?.name === 'TimeoutError' ? 'timeout' : 'network error' };
  }
}

export const postTransaction = (tenant, body) => request(tenant, 'POST', tmPath(tenant, 'transactions'), body);
export const getTransaction = (tenant, id) => request(tenant, 'GET', tmPath(tenant, 'transaction', id));

/** Update a Didit user's custom properties by vendor_data. */
export const updateUserCustomProperties = (tenant, vendorData, customProperties) =>
  request(tenant, 'PATCH', tmPath(tenant, 'userCustomProperties', vendorData), { custom_properties: customProperties });

export const createRule = (tenant, ruleJson) => request(tenant, 'POST', tmPath(tenant, 'rules'), ruleJson);

export const upsertRule = (tenant, ruleJson, diditRuleId) =>
  diditRuleId
    ? request(tenant, 'PATCH', tmPath(tenant, 'rule', diditRuleId), ruleJson)
    : createRule(tenant, ruleJson);

export const getRule = (tenant, diditRuleId) => request(tenant, 'GET', tmPath(tenant, 'rule', diditRuleId));

/** Stateless: evaluates a candidate configuration against recent history. Returns { evaluated, matched, affected_entities, period_days }. */
export const backtestRule = (tenant, payload) => request(tenant, 'POST', tmPath(tenant, 'ruleBacktest'), payload);

export const createFiuReport = (tenant, payload) => request(tenant, 'POST', tmPath(tenant, 'fiuReports'), payload);
export const getFiuReport = (tenant, id) => request(tenant, 'GET', tmPath(tenant, 'fiuReport', id));

export const createDiditCase = (tenant, payload) => request(tenant, 'POST', tmPath(tenant, 'cases'), payload);

/** Downloads a generated file. The API key is only sent to Didit hosts. Returns Uint8Array. */
export async function downloadBinary(tenant, url) {
  const apiKey = tenant?.didit_api_key;
  if (!apiKey) throw { status: 412, detail: 'Didit credentials not found — check TenantSecret' };
  const abs = /^https?:\/\//i.test(url) ? url : BASE_URL + url;
  const u = new URL(abs);
  if (u.protocol !== 'https:') throw { status: 400, detail: 'Refusing to download over a non-HTTPS link' };
  const headers = u.hostname.endsWith('didit.me') ? { 'x-api-key': apiKey } : {};
  const res = await fetch(abs, { headers, signal: AbortSignal.timeout(30000) });
  if (!res.ok) throw { status: res.status, detail: `File download failed (${res.status})` };
  return new Uint8Array(await res.arrayBuffer());
}