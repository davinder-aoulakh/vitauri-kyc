// profileFieldMap — links outreach questions to KYC client fields.
// An OutreachTemplate with profile_field fills that field: the portal can show what we hold (prefill_value) and the
// client's answer goes to Profile Verification for the analyst to accept. Keep keys in sync with
// base44/functions/buildProfileSuggestions (extractFromOutreach) and src/hooks/useProfileSuggestions.js.

export const PROFILE_FIELDS = [
  // Natural person
  { key: 'full_name', label: 'Full name', type: 'text', clients: ['NP', 'ORG'], match: /^(full|legal|company) name|^name$|naam/i },
  { key: 'first_names', label: 'First names', type: 'text', clients: ['NP'], match: /first name|given name|voornamen/i },
  { key: 'last_name', label: 'Last name', type: 'text', clients: ['NP'], match: /last name|surname|achternaam/i },
  { key: 'preferred_name', label: 'Preferred name', type: 'text', clients: ['NP'], match: /preferred name|roepnaam/i },
  { key: 'date_of_birth', label: 'Date of birth', type: 'date', clients: ['NP'], match: /date of birth|birth date|geboortedatum|\bdob\b/i },
  { key: 'place_of_birth', label: 'Place of birth', type: 'text', clients: ['NP'], match: /place of birth|geboorteplaats/i },
  { key: 'country_of_birth', label: 'Country of birth', type: 'country', clients: ['NP'], match: /country of birth|geboorteland/i },
  { key: 'nationality', label: 'Nationality', type: 'country', clients: ['NP'], match: /nationalit/i },
  { key: 'country_of_residence', label: 'Country of residence', type: 'country', clients: ['NP'], match: /country of residence|woonland/i },
  { key: 'residential_address', label: 'Residential address', type: 'address', clients: ['NP'], match: /residential address|home address|woonadres|^address$|^adres$/i },
  { key: 'postal_address', label: 'Postal address', type: 'address', clients: ['NP', 'ORG'], match: /postal address|correspondence address|postadres/i },
  { key: 'occupation', label: 'Occupation', type: 'text', clients: ['NP'], match: /occupation|profession|beroep/i },
  { key: 'employer_name', label: 'Employer', type: 'text', clients: ['NP'], match: /employer|werkgever/i },
  // Organisation
  { key: 'registration_number', label: 'Registration number (KvK)', type: 'text', clients: ['ORG'], match: /registration number|kvk|chamber of commerce number/i },
  { key: 'legal_form', label: 'Legal form', type: 'text', clients: ['ORG'], match: /legal form|rechtsvorm/i },
  { key: 'registered_country', label: 'Country of registration', type: 'country', clients: ['ORG'], match: /country of (registration|incorporation)|registered country/i },
  { key: 'registered_address', label: 'Registered address', type: 'address', clients: ['ORG'], match: /company address|registered address|business address|vestigingsadres/i },
  { key: 'lei_code', label: 'LEI code', type: 'text', clients: ['ORG'], match: /\blei\b/i },
  // Both
  { key: 'primary_contact_email', label: 'Email address', type: 'text', clients: ['NP', 'ORG'], match: /e-?mail/i },
  { key: 'primary_contact_phone', label: 'Phone number', type: 'phone', clients: ['NP', 'ORG'], match: /phone|mobile|telefoon|tel\b/i },
  { key: 'tin', label: 'Tax identification number (TIN)', type: 'text', clients: ['NP', 'ORG'], match: /\btin\b|tax identification|fiscaal nummer|bsn/i },
  { key: 'tax_residency', label: 'Tax residency', type: 'country', clients: ['NP', 'ORG'], match: /tax residen/i },
];

export const profileFieldByKey = (key) => PROFILE_FIELDS.find((f) => f.key === key) || null;

/** Best KYC field for a question label (null when nothing fits). */
export function suggestProfileField(label, clientTypes = []) {
  const l = String(label || '').trim();
  if (!l) return null;
  return PROFILE_FIELDS.find((f) => f.match.test(l) && (!clientTypes.length || clientTypes.some((t) => f.clients.includes(t)))) || null;
}

const ADDR_KEYS = ['street', 'number', 'zipcode', 'city', 'area', 'country'];
export const isAddressEmpty = (a) => !a || ADDR_KEYS.every((k) => !String(a[k] || '').trim());

/** "Van Goyenstraat 1, 5161VL Sprang-Capelle, Netherlands" */
export function addressToText(a) {
  if (!a || typeof a !== 'object') return String(a || '');
  const line1 = [a.street, a.number].filter(Boolean).join(' ');
  const line2 = [a.zipcode, a.city].filter(Boolean).join(' ');
  return [line1, line2, a.area, a.country].map((s) => String(s || '').trim()).filter(Boolean).join(', ');
}

/** What we hold for this field (string, or address object). Null when empty. */
export function prefillFromClient(profileField, client) {
  if (!client || !profileField) return null;
  const f = profileFieldByKey(profileField);
  if (!f) return null;
  if (f.type === 'address') {
    // ORG: the structured address lives in residential_address; registered_address is a text line
    const obj = profileField === 'registered_address' ? (isAddressEmpty(client.residential_address) ? null : client.residential_address) : client[profileField];
    if (obj && typeof obj === 'object' && !isAddressEmpty(obj)) return { ...obj };
    if (profileField === 'registered_address' && client.registered_address) return { street: String(client.registered_address), country: client.registered_country || '' };
    return null;
  }
  if (profileField === 'primary_contact_phone') {
    const e = (client.contact_entries || []).find((x) => (x.type === 'phone' || x.type === 'mobile') && x.is_preferred) || (client.contact_entries || []).find((x) => x.type === 'phone' || x.type === 'mobile');
    return e?.value || client.primary_contact_phone || null;
  }
  if (profileField === 'primary_contact_email') {
    const e = (client.contact_entries || []).find((x) => x.type === 'email' && x.is_preferred) || (client.contact_entries || []).find((x) => x.type === 'email');
    return e?.value || client.primary_contact_email || null;
  }
  const v = client[profileField];
  return v == null || v === '' || v === 'null' ? null : String(v);
}

/** Readable text of a structured answer (kept in response_text for lists, emails and the report). */
export function responseText(fieldType, value) {
  if (fieldType === 'address') return addressToText(value);
  return value == null ? '' : String(value);
}
