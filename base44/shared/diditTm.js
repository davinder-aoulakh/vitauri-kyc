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
  ruleLibrary: '/v3/transactions/rules/library/',
  userCustomProperties: (vendorData) => `/v3/users/${enc(vendorData)}/`,
  fiuReports: '/v3/fiu-reports/',
  fiuReport: (id) => `/v3/fiu-reports/${enc(id)}/`,
  cases: '/v3/cases/',
  transactionSdkToken: '/v3/transactions/sdk-token/',
  eventsBatch: '/v3/events/batch/',
  eventsSdkToken: '/v3/events/sdk-token/',
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

// ── Wire helpers (docs.didit.me/openapi-25.json, POST /v3/transactions/) ─────────────────────────
// Didit statuses: APPROVED | IN_REVIEW | DECLINED | AWAITING_USER. PENDING is Vitauri's own "not yet evaluated".
export const TXN_STATUSES = ['PENDING', 'APPROVED', 'IN_REVIEW', 'DECLINED', 'AWAITING_USER'];
export function normaliseTxnStatus(s, fallback = 'PENDING') {
  const v = String(s ?? '').toUpperCase().replace(/[\s-]+/g, '_');
  return TXN_STATUSES.includes(v) ? v : fallback;
}

/** Didit subject.entity_type is `individual` or `company` (legacy rows may hold 'person'). */
export function subjectEntityType(t, client) {
  const v = String(t?.subject_entity_type || '').toLowerCase();
  if (v === 'company') return 'company';
  if (v === 'person' || v === 'individual') return 'individual';
  return client?.client_type === 'ORG' ? 'company' : 'individual';
}

/** Didit's stable id for follow-up calls is `uuid` (our id comes back as `txn_id`). */
export const diditTxnUuid = (res) => res?.uuid || res?.transaction?.uuid || res?.id || null;

/** Request body for one Vitauri Transaction. Our transaction_id is the idempotency key and must be stable across retries. */
export function buildTransactionBody(t, client, ourId, tenantId, profile) {
  const subjectCountry = client?.client_type === 'ORG' ? client?.registered_country : client?.country_of_residence;
  const body = {
    transaction_id: ourId,
    transaction_category: t.transaction_category || 'finance',
    ...(t.executed_at ? { transaction_at: t.executed_at } : {}),
    transaction_details: {
      direction: t.direction, amount: t.amount, currency: t.currency, currency_kind: t.currency_kind || 'fiat',
      ...(t.fx?.amount_reporting != null && t.fx?.reporting_currency ? { amount_in_default_currency: t.fx.amount_reporting, default_currency: t.fx.reporting_currency } : {}),
    },
    subject: {
      entity_type: subjectEntityType(t, client),
      vendor_data: t.client_id,
      full_name: t.subject_full_name || client?.full_name,
      ...(subjectCountry && /^[A-Za-z]{2,3}$/.test(subjectCountry) ? { address: { country: String(subjectCountry).toUpperCase() } } : {}),
    },
    counterparty: {
      ...(t.counterparty_name ? { full_name: t.counterparty_name } : {}),
      payment_method: { method_type: t.counterparty_method_type || 'bank_account', ...(t.counterparty_account_id ? { account_id: t.counterparty_account_id } : {}) },
      ...(t.counterparty_country ? { address: { country: String(t.counterparty_country).toUpperCase() } } : {}),
    },
    metadata: { tenant_id: tenantId, client_id: t.client_id, our_transaction_id: ourId },
  };
  if (profile) {
    body.custom_properties = {
      profile_version: profile.version, inbound_max_month: profile.inbound_max_month,
      outbound_foreign_max_month: profile.outbound_foreign_max_month, allowed_countries: profile.allowed_countries,
      cash_max_month: profile.cash_max_month,
    };
  }
  return body;
}

/** Page through GET /v3/transactions/ (limit/offset only) looking for our txn_id. Returns the record or null. */
export async function findTransactionByTxnId(tenant, txnId, { pages = 5, limit = 100 } = {}) {
  for (let p = 0; p < pages; p++) {
    const res = await request(tenant, 'GET', `${tmPath(tenant, 'transactions')}?limit=${limit}&offset=${p * limit}`);
    const rows = Array.isArray(res) ? res : (res?.results || res?.items || []);
    const hit = rows.find((r) => r?.txn_id === txnId);
    if (hit) return hit;
    if (rows.length < limit || (!Array.isArray(res) && !res?.next && res?.results)) return null;
  }
  return null;
}

/** Scoped device credentials. Only the token and expiry are returned to callers. */
export const mintTransactionToken = (tenant, { vendor_data, ttl_seconds, max_uses }) =>
  request(tenant, 'POST', tmPath(tenant, 'transactionSdkToken'), { vendor_data, ...(ttl_seconds ? { ttl_seconds } : {}), ...(max_uses ? { max_uses } : {}) });
export const mintMonitoringToken = (tenant, { vendor_data, ttl_seconds, max_uses, allowed_event_categories }) =>
  request(tenant, 'POST', tmPath(tenant, 'eventsSdkToken'), {
    vendor_data, ...(ttl_seconds ? { ttl_seconds } : {}), ...(max_uses ? { max_uses } : {}),
    ...(allowed_event_categories?.length ? { allowed_event_categories } : {}),
  });
/** Server lane: up to 500 events; 201 all accepted, 207 partial (per-index results). */
export const postEventsBatch = (tenant, events) => request(tenant, 'POST', tmPath(tenant, 'eventsBatch'), { events });
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

const qs = (params) => {
  const p = Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== '').map(([k, v]) => `${enc(k)}=${enc(v)}`);
  return p.length ? `?${p.join('&')}` : '';
};
const pageOf = (res) => ({ count: res?.count ?? (Array.isArray(res) ? res.length : 0), results: Array.isArray(res) ? res : (res?.results || []), next: !!res?.next });

/** Didit's preset rule library (read-only). Returns { count, results, next }. */
export const listLibraryRules = async (tenant, { search, category, bundle, limit = 50, offset = 0 } = {}) =>
  pageOf(await request(tenant, 'GET', `${tmPath(tenant, 'ruleLibrary')}${qs({ search, category, bundle, limit, offset })}`));

/** Rules registered in Didit for this application (read-only). Returns { count, results, next }. */
export const listRules = async (tenant, { limit = 100, offset = 0, mode } = {}) =>
  pageOf(await request(tenant, 'GET', `${tmPath(tenant, 'rules')}${qs({ limit, offset, mode })}`));

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