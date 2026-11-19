// Didit company registry (standalone KYB API, x-api-key). search -> candidates (ephemeral kyb_response_id), select -> the
// Lite profile with officers. Billed in live: $0.50 per successful search, the country's Lite price per select; sandbox free.
// Fails soft: { ok: false, error_code, message }. Never returns or logs the key.
const BASE = 'https://verification.didit.me';

async function post(fetchFn, apiKey, path, body) {
  let res;
  try {
    res = await fetchFn(`${BASE}${path}`, { method: 'POST', headers: { 'x-api-key': apiKey, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  } catch (e) { return { ok: false, error_code: 'network', message: String(e?.message || e).slice(0, 200) }; }
  const json = await res.json().catch(() => ({}));
  if (!res.ok) return { ok: false, error_code: res.status === 403 ? 'forbidden_or_credits' : res.status === 400 ? 'bad_request' : `http_${res.status}`, message: String(json?.detail || json?.error || json?.message || `Didit ${res.status}`).slice(0, 200), status: res.status };
  return { ok: true, json, status: res.status };
}

/** Candidates for a name or registration number in one country (ISO-2). */
export async function diditSearch({ fetchFn = fetch, apiKey, country_code, name, registration_number }) {
  const body = { country_code, search_type: 'contains', ...(name ? { name } : {}), ...(registration_number ? { registration_number } : {}) };
  const r = await post(fetchFn, apiKey, '/v3/kyb/search/', body);
  if (!r.ok) return r;
  const reg = r.json?.kyb_registry || {};
  return {
    ok: true, resolved: reg.search_resolved !== false, request_id: r.json?.request_id || null,
    candidates: (reg.companies || []).slice(0, 15).map((c) => ({ id: c.kyb_response_id, name: c.name || '', number: c.registration_number || '', status: c.status || '', type: c.type || '', address: c.registered_address || '' })),
  };
}

/** The Lite profile of one candidate. pending: true when the registry has not finished (re-read later, do not re-select). */
export async function diditSelect({ fetchFn = fetch, apiKey, kyb_response_id }) {
  const r = await post(fetchFn, apiKey, '/v3/kyb/select/', { kyb_response_id });
  if (!r.ok) return r;
  const c = r.json?.kyb_registry || r.json?.company || {};
  return { ok: true, pending: c.fetch_status === 'pending' || c.data_resolved === false, request_id: r.json?.request_id || null, company: mapDiditCompany(c), sandbox: !!c.registry_data?.sandbox };
}

/** Didit company -> outreach fields. Website, phone, e-mail, sales and employees are not kept (spec does not ask for them). */
export function mapDiditCompany(c = {}) {
  const status = c.registry_status ? String(c.registry_status) : '';
  return {
    legal_name: c.company_name || '', reg_no: c.registration_number || '', co_status: status ? status.charAt(0).toUpperCase() + status.slice(1) : '',
    co_address: c.registered_address || (c.addresses || [])[0]?.address || '', co_activity: c.nature_of_business || '', reg_date: c.incorporation_date || '',
    legal_form_raw: c.company_type || '', country_code: c.country_code || '',
    officers: (c.officers || []).filter((o) => o?.name).slice(0, 20).map((o) => ({ name: o.name, role: o.role || '' })),
  };
}

export const isActiveStatus = (s) => !s || /^activ/i.test(String(s).trim());
