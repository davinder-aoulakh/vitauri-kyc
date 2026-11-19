// KvK (Dutch trade register): Zoeken (typeahead by name or KvK number) and Basisprofiel (once per selection, EUR 0.02 live).
// Test mode uses KvK's public test environment with fictitious companies. KvK returns no directors.
// Fails soft: { ok: false, error_code, message }. Never returns or logs the key.
const BASE = { test: 'https://api.kvk.nl/test/api', live: 'https://api.kvk.nl/api' };
// KvK's own published key for its test environment (not a secret; fictitious data only). Live always needs the tenant's key.
export const KVK_PUBLIC_TEST_KEY = 'l7xx1f2691f2520d487b902f4e0b57a0b197';

async function get(fetchFn, mode, apiKey, path) {
  const key = apiKey || (mode === 'test' ? KVK_PUBLIC_TEST_KEY : '');
  if (!key) return { ok: false, error_code: 'no_key', message: 'No KvK key configured' };
  let res;
  try { res = await fetchFn(`${BASE[mode] || BASE.test}${path}`, { headers: { apikey: key, Accept: 'application/json' } }); } catch (e) { return { ok: false, error_code: 'network', message: String(e?.message || e).slice(0, 200) }; }
  const json = await res.json().catch(() => ({}));
  if (res.status === 404) return { ok: true, json: {}, notFound: true };
  if (!res.ok) return { ok: false, error_code: `http_${res.status}`, message: String(json?.fout?.[0]?.omschrijving || json?.message || `KvK ${res.status}`).slice(0, 200) };
  return { ok: true, json };
}

/** Typeahead: a KvK number (8 digits) or a name of at least 2 characters. */
export async function kvkSearch({ fetchFn = fetch, mode = 'test', apiKey, q }) {
  const t = String(q || '').trim();
  if (t.length < 2) return { ok: true, candidates: [] };
  const qs = /^\d{8}$/.test(t) ? `kvkNummer=${t}` : `naam=${encodeURIComponent(t)}`;
  const r = await get(fetchFn, mode, apiKey, `/v2/zoeken?${qs}&resultatenPerPagina=10`);
  if (!r.ok) return r;
  const list = r.json?.resultaten || [];
  return {
    ok: true,
    candidates: list.filter((x) => x.kvkNummer).map((x) => ({ id: x.kvkNummer, number: x.kvkNummer, name: x.naam || '', city: x.adres?.binnenlandsAdres?.plaats || x.adres?.buitenlandsAdres?.land || '', status: x.actief === 'Nee' ? 'Inactive' : 'Active', type: x.type || '' }))
      .filter((x, i, a) => a.findIndex((y) => y.id === x.id) === i),
  };
}

/** Basisprofiel of one KvK number. */
export async function kvkProfile({ fetchFn = fetch, mode = 'test', apiKey, kvk }) {
  const r = await get(fetchFn, mode, apiKey, `/v1/basisprofielen/${encodeURIComponent(kvk)}`);
  if (!r.ok) return r;
  if (r.notFound) return { ok: false, error_code: 'not_found', message: 'Not found in the trade register' };
  return { ok: true, company: mapKvkProfile(r.json) };
}

export function mapKvkProfile(p = {}) {
  const owner = p._embedded?.eigenaar || {};
  const hv = p._embedded?.hoofdvestiging || {};
  const addr = (hv.adressen || owner.adressen || []).find((a) => a.type === 'bezoekadres') || (hv.adressen || owner.adressen || [])[0] || {};
  const sbi = (p.sbiActiviteiten || []).find((s) => s.indHoofdactiviteit === 'Ja') || (p.sbiActiviteiten || [])[0];
  const ended = p.materieleRegistratie?.datumEinde;
  return {
    legal_name: p.statutaireNaam || p.naam || '', reg_no: p.kvkNummer || '', rsin: owner.rsin || '',
    legal_form: owner.uitgebreideRechtsvorm || owner.rechtsvorm || '', co_status: ended ? `Inactive (ended ${ended})` : 'Active',
    co_address: addr.volledigAdres || [addr.straatnaam, addr.huisnummer, addr.postcode, addr.plaats].filter(Boolean).join(' '),
    sbi: sbi ? `${sbi.sbiCode} ${sbi.sbiOmschrijving}` : '', reg_date: p.formeleRegistratiedatum ? `${p.formeleRegistratiedatum.slice(6, 8)}-${p.formeleRegistratiedatum.slice(4, 6)}-${p.formeleRegistratiedatum.slice(0, 4)}` : '',
    trade_name: (p.handelsnamen || []).map((h) => h.naam).filter(Boolean)[0] || '', officers: [],
  };
}
