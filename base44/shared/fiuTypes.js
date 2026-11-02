// FIU report types (goAML). Pure. Mirrored in src/lib/fiuTypes.js — keep both in sync.
// transaction: the goAML report carries <transaction> elements; activity: <activity><report_parties> (no transactions needed).

export const FIU_TYPES = {
  SAR: { label: 'Suspicious Activity Report', kind: 'activity', manual: true },
  STR: { label: 'Suspicious Transaction Report', kind: 'transaction', manual: true },
  UTR: { label: 'Unusual Transaction Report', kind: 'transaction', manual: true },
  CTR: { label: 'Cash Transaction Report', kind: 'transaction', threshold: 'ctr_cash' },
  TTR: { label: 'Threshold Transaction Report', kind: 'transaction', threshold: 'ttr' },
  IFT: { label: 'International Funds Transfer Report', kind: 'transaction', threshold: 'ift' },
  CBR: { label: 'Cross-Border (cash / bearer instrument) Report', kind: 'transaction', threshold: 'cbr' },
  TFR: { label: 'Terrorist Financing Report', kind: 'activity', urgent: true },
};
export const FIU_TYPE_CODES = Object.keys(FIU_TYPES);

/** Legacy rows (unusual_objective / unusual_subjective) read as UTR. */
export const normaliseType = (t) => (FIU_TYPES[t] ? t : 'UTR');
const LEGACY_SUFFIX = { unusual_objective: ' (objective)', unusual_subjective: ' (subjective)' };
/** "Cash Transaction Report", "Unusual Transaction Report (objective)" for legacy rows. */
export const typeLabelOf = (t) => `${FIU_TYPES[normaliseType(t)].label}${LEGACY_SUFFIX[t] || ''}`;

/** Types the profile allows; all types when the profile has no list yet. */
export const enabledTypes = (fiu) => {
  const list = (fiu?.enabled_report_types || []).filter((t) => FIU_TYPES[t]);
  return list.length ? list : FIU_TYPE_CODES;
};

/** goAML report_code for this FIU: profile override, else the type code. */
export const reportCodeFor = (fiu, type) => String(fiu?.report_codes?.[normaliseType(type)] || '').trim() || normaliseType(type);

export const CASH_CATEGORIES = ['cash_deposit', 'cash_withdrawal'];
export const isCash = (t) => CASH_CATEGORIES.includes(t?.category)
  || (!t?.counterparty_method_type && /\b(cash|contant|bearer|cheque)\b/i.test(String(t?.description_raw || '')));
const COUNTRY_ALIASES = { curacao: 'CW', 'curaçao': 'CW', cw: 'CW', cuw: 'CW', netherlands: 'NL', nederland: 'NL', nl: 'NL', nld: 'NL' };
export const iso2 = (c) => { const v = String(c || '').trim(); if (!v) return ''; return COUNTRY_ALIASES[v.toLowerCase()] || v.toUpperCase(); };
/** Reporting country of a profile: country_code, else the profile code (CW / NL). */
export const profileCountry = (fiu) => iso2(fiu?.country_code || fiu?.code);
export const isCrossBorder = (t, fiu) => { const c = iso2(t?.counterparty_country); return !!c && c !== profileCountry(fiu); };

/** Terrorism-financing signal in free text (screening list, scenario name / code). */
export const TF_PATTERN = /terror|\bTF\b|financing of terrorism|terrorismefinanciering|\bFTO\b|ISIL|al[- ]qaida/i;
