// profileValueMatch — is a value from a source (Didit ID check, outreach, document) the SAME as what the client file holds?
// Same fact in another notation ("NLD" vs "Netherlands (NL)", "M" vs "Male", "1988-01-14T00:00:00Z" vs "1988-01-14")
// must not be offered to the analyst as a change. Pure; mirrored in base44/functions/buildProfileSuggestions (sameVal).
import { countryByName, COUNTRY_META } from '@/lib/countries';
import { ISO3_MAP } from '@/lib/diditIso3Map';

export const COUNTRY_FIELDS = ['nationality', 'country_of_residence', 'country_of_birth', 'residential_address.country', 'registered_country', 'tax_residency'];
const NAME_FIELDS = ['full_name', 'first_names', 'last_name', 'preferred_name', 'initials'];
const DATE_FIELDS = ['date_of_birth', 'id_expiry_date'];

const text = (v) => String(v ?? '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();

/** Country record for "NLD", "NL", "Netherlands", "Netherlands (NL)" or "Nederland"; null when unknown. */
export function resolveCountry(value) {
  const v = String(value ?? '').trim();
  if (!v) return null;
  if (/^[A-Za-z]{3}$/.test(v) && ISO3_MAP[v.toUpperCase()]) return countryByName(ISO3_MAP[v.toUpperCase()]);
  return countryByName(v);
}

const gender = (v) => { const g = text(v); return g === 'm' || g === 'male' || g === 'man' ? 'male' : g === 'f' || g === 'female' || g === 'vrouw' ? 'female' : g; };

export function sameProfileValue(fieldKey, a, b) {
  const x = String(a ?? '').trim();
  const y = String(b ?? '').trim();
  if (!x || !y) return false;
  if (COUNTRY_FIELDS.includes(fieldKey)) {
    const ca = resolveCountry(x), cb = resolveCountry(y);
    if (ca && cb) return ca.iso2 === cb.iso2;
    return text(x) === text(y);
  }
  if (DATE_FIELDS.includes(fieldKey)) return x.slice(0, 10) === y.slice(0, 10);
  if (fieldKey === 'gender') return gender(x) === gender(y);
  if (NAME_FIELDS.includes(fieldKey)) return text(x).replace(/[.\-']/g, '') === text(y).replace(/[.\-']/g, '');
  return text(x) === text(y);
}

/** The value as the client file stores it: countries in the app's own format ("Netherlands (NL)"), never a bare ISO-3 code. */
export function toFileValue(fieldKey, value) {
  const v = String(value ?? '').trim();
  if (!COUNTRY_FIELDS.includes(fieldKey) || !v) return v;
  const c = resolveCountry(v);
  if (!c) return v;
  const known = COUNTRY_META.find((m) => m.iso2 === c.iso2);
  return known ? `${known.name} (${known.iso2})` : v;
}
