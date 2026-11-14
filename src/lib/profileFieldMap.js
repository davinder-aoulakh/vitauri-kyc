// profileFieldMap — links outreach questions to KYC client fields.
// An OutreachTemplate with profile_field fills that field: the portal can show what we hold (prefill_value) and the
// client's answer goes to Profile Verification for the analyst to accept. Keep keys in sync with
// base44/functions/buildProfileSuggestions (extractFromOutreach) and src/hooks/useProfileSuggestions.js.

// Labels are the KYC field names (same as the New Client form and the Profile Verification grid): one name everywhere.
// orgLabel: the name of the same key on an organisation's file.
// Expected use of the account: the answers land in step 4 (section 1B) and feed the monitoring profile.
export const EXPECTED_USE = {
  types: ['Payments', 'Investments', 'Transfers', 'FX', 'Other'],
  frequency: ['Daily', 'Weekly', 'Monthly', 'Quarterly', 'Annually', 'Ad hoc'],
  volumes: ['< €10k/year', '€10k–€100k/year', '€100k–€1M/year', '€1M–€10M/year', '> €10M/year'],
  geographies: ['Domestic only', 'EU/EEA', 'UK', 'USA/Canada', 'Asia Pacific', 'Middle East', 'Africa', 'Latin America', 'Other'],
  cash: ['None', 'Occasional', 'Regular'],
};
const BOTH = ['NP', 'ORG'];
export const EXPECTED_USE_FIELDS = [
  { key: 'expected_use.types', label: 'Expected use: transaction types', fieldType: 'multi_select', options: EXPECTED_USE.types, clients: BOTH, group: 'expected_use', match: /what will you use|transaction types|use of the account|gebruik van de rekening/i },
  { key: 'expected_use.frequency', label: 'Expected use: transaction frequency', fieldType: 'dropdown', options: EXPECTED_USE.frequency, clients: BOTH, group: 'expected_use', match: /how often|transaction frequency|frequentie/i },
  { key: 'expected_use.volumes', label: 'Expected use: yearly volume', fieldType: 'dropdown', options: EXPECTED_USE.volumes, clients: BOTH, group: 'expected_use', match: /yearly volume|expected volume|annual volume|jaarvolume/i },
  { key: 'expected_use.inbound_month', label: 'Expected use: incoming per month', fieldType: 'number', clients: BOTH, group: 'expected_use', match: /incoming per month|inbound per month|inkomend per maand/i },
  { key: 'expected_use.outbound_month', label: 'Expected use: outgoing per month', fieldType: 'number', clients: BOTH, group: 'expected_use', match: /outgoing per month|outbound per month|uitgaand per maand/i },
  { key: 'expected_use.counterparties', label: 'Expected use: main counterparties', fieldType: 'textarea', clients: BOTH, group: 'expected_use', match: /counterpart|pay or receive|tegenpartij/i },
  { key: 'expected_use.geographies', label: 'Expected use: countries / regions', fieldType: 'multi_select', options: EXPECTED_USE.geographies, clients: BOTH, group: 'expected_use', match: /countries.*(involved|transact)|regions involved|geograph/i },
  { key: 'expected_use.cash', label: 'Expected use: cash', fieldType: 'dropdown', options: EXPECTED_USE.cash, clients: BOTH, group: 'expected_use', match: /cash use|expected cash|contant/i },
].map((f) => ({ type: 'text', ...f }));

export const PROFILE_FIELDS = [
  // Natural person
  { key: 'full_name', label: 'Full Name', orgLabel: 'Legal Entity Name', type: 'text', clients: ['NP', 'ORG'], match: /^(full|legal|company) name|full name of the company|^name$|naam/i },
  { key: 'first_names', label: 'First Names', type: 'text', clients: ['NP'], match: /first name|given name|voornamen/i },
  { key: 'last_name', label: 'Last Name', type: 'text', clients: ['NP'], match: /last name|surname|achternaam/i },
  { key: 'initials', label: 'Initials', type: 'text', clients: ['NP'], match: /initials|voorletters/i },
  { key: 'preferred_name', label: 'Preferred Name', type: 'text', clients: ['NP'], match: /preferred name|roepnaam/i },
  { key: 'gender', label: 'Gender', type: 'text', clients: ['NP'], match: /gender|geslacht/i },
  { key: 'date_of_birth', label: 'Date of Birth', type: 'date', clients: ['NP'], match: /date of birth|birth date|geboortedatum|\bdob\b/i },
  { key: 'country_of_birth', label: 'Country of Birth', type: 'country', clients: ['NP'], match: /country of birth|geboorteland/i },
  { key: 'place_of_birth', label: 'Place of Birth', type: 'text', clients: ['NP'], match: /place of birth|geboorteplaats/i },
  { key: 'nationality', label: 'Nationality', type: 'country', clients: ['NP'], match: /nationalit/i },
  { key: 'country_of_residence', label: 'Country of Residence', type: 'country', clients: ['NP'], match: /country of residence|woonland/i },
  { key: 'id_type', label: 'ID Type', type: 'text', clients: ['NP'], match: /id type|document type|type of id/i },
  { key: 'id_number', label: 'ID Number', type: 'text', clients: ['NP'], match: /id number|document number|passport number/i },
  { key: 'residential_address', label: 'Residential Address', type: 'address', clients: ['NP'], match: /residential address|home address|woonadres|^address$|^adres$/i },
  { key: 'postal_address', label: 'Postal Address', type: 'address', clients: ['NP', 'ORG'], match: /postal address|correspondence address|postadres/i },
  { key: 'occupation', label: 'Occupation', type: 'text', clients: ['NP'], match: /occupation|profession|beroep/i },
  { key: 'employer_name', label: 'Employer', type: 'text', clients: ['NP'], match: /employer|werkgever/i },
  // Organisation
  { key: 'registration_number', label: 'Registration Number', type: 'text', clients: ['ORG'], match: /registration number|kvk|chamber of commerce number/i },
  { key: 'legal_form', label: 'Legal Form', type: 'text', clients: ['ORG'], match: /legal form|rechtsvorm/i },
  { key: 'registered_country', label: 'Registered Country', type: 'country', clients: ['ORG'], match: /country of (registration|incorporation)|registered country/i },
  { key: 'registered_address', label: 'Registered Address', type: 'address', clients: ['ORG'], match: /company address|registered address|business address|vestigingsadres/i },
  { key: 'sector', label: 'Sector / Industry', type: 'text', clients: ['ORG'], match: /sector|industry|branche/i },
  { key: 'lei_code', label: 'LEI Code', type: 'text', clients: ['ORG'], match: /\blei\b/i },
  // Both
  { key: 'primary_contact_email', label: 'Email Address', type: 'text', clients: ['NP', 'ORG'], match: /e-?mail/i },
  { key: 'primary_contact_phone', label: 'Phone Number', type: 'phone', clients: ['NP', 'ORG'], match: /phone|mobile|telefoon|tel\b/i },
  { key: 'tin', label: 'Tax Identification Number (TIN)', type: 'text', clients: ['NP', 'ORG'], match: /\btin\b|tax identification|fiscaal nummer|bsn/i },
  { key: 'tax_residency', label: 'Tax Residency', type: 'country', clients: ['NP', 'ORG'], match: /tax residen/i },
  ...EXPECTED_USE_FIELDS,
];

/** The KYC name of a linked field for the given client types (an ORG-only question uses the organisation's name for the key). */
export function kycFieldLabel(key, clientTypes = []) {
  const f = PROFILE_FIELDS.find((x) => x.key === key);
  if (!f) return '';
  const orgOnly = clientTypes.length > 0 && clientTypes.every((t) => t === 'ORG');
  return orgOnly && f.orgLabel ? f.orgLabel : f.label;
}

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
  if (!f || f.group === 'expected_use') return null;   // expected use is asked fresh, never prefilled from the client record
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
