// Which rule libraries / library scenarios apply to a tenant (spec section 11: libraries follow the tenant's
// jurisdictions). Pure: no I/O. An empty or missing list means "not configured": everything stays available, as before.

/** Libraries Vitauri ships, by jurisdiction code. */
export const LIBRARIES = [
  { code: 'CW', label: 'Library: Curaçao objective indicators' },
  { code: 'NL', label: 'Library: Wwft indicators' },
];

/** Clean list of upper-case ISO country codes; [] when nothing usable was given. */
export function normaliseJurisdictions(value) {
  const list = Array.isArray(value) ? value : typeof value === 'string' ? value.split(/[\s,;]+/) : [];
  return [...new Set(list.map((c) => String(c ?? '').trim().toUpperCase()).filter((c) => /^[A-Z]{2}$/.test(c)))];
}

/** The library buttons to show for a tenant. */
export function librariesFor(jurisdictions) {
  const j = normaliseJurisdictions(jurisdictions);
  return j.length ? LIBRARIES.filter((l) => j.includes(l.code)) : LIBRARIES;
}
export const libraryCodesFor = (jurisdictions) => librariesFor(jurisdictions).map((l) => l.code);

/** True when a library scenario with this jurisdiction ('ALL' or a country code) should be seeded for the tenant. */
export function scenarioInScope(scenarioJurisdiction, jurisdictions) {
  const j = normaliseJurisdictions(jurisdictions);
  const s = String(scenarioJurisdiction || 'ALL').toUpperCase();
  return s === 'ALL' || !j.length || j.includes(s);
}
