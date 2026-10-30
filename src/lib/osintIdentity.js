// Same key as base44/shared/osintSearch.js clientIdentityKey: when it differs from the cached search's identity_key,
// the client's names/identifiers changed after the last OSINT search and the panel suggests a re-run.
const clean = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();

export function clientIdentityKey(c) {
  const a = c?.residential_address || {};
  return [c?.full_name, c?.preferred_name, c?.first_names, c?.last_name, c?.date_of_birth, c?.employer_name, c?.occupation,
    c?.primary_contact_email, a?.city, c?.registration_number, c?.registered_country, c?.country_of_residence]
    .map((v) => clean(v).toLowerCase()).join('|');
}
