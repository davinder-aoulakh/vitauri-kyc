// FIU report types (goAML). Mirror of base44/shared/fiuTypes.js — keep both in sync.
export const FIU_TYPES = {
  SAR: { label: 'Suspicious Activity Report', short: 'Suspicious activity', kind: 'activity', hint: 'Suspicious behaviour, with or without transactions.' },
  STR: { label: 'Suspicious Transaction Report', short: 'Suspicious transaction', kind: 'transaction', hint: 'Specific transactions you suspect.' },
  UTR: { label: 'Unusual Transaction Report', short: 'Unusual transaction', kind: 'transaction', hint: 'Unusual transactions (objective or subjective indicators).' },
  CTR: { label: 'Cash Transaction Report', short: 'Cash transaction', kind: 'transaction', threshold: 'ctr_cash', hint: 'Cash at or above the profile threshold per client per day.' },
  TTR: { label: 'Threshold Transaction Report', short: 'Threshold transaction', kind: 'transaction', threshold: 'ttr', hint: 'Any transactions at or above the profile threshold per client per day.' },
  IFT: { label: 'International Funds Transfer Report', short: 'International transfer', kind: 'transaction', threshold: 'ift', hint: 'Cross-border transfers at or above the threshold.' },
  CBR: { label: 'Cross-Border Report', short: 'Cross-border cash / bearer', kind: 'transaction', threshold: 'cbr', hint: 'Cash or bearer instruments crossing the border.' },
  TFR: { label: 'Terrorist Financing Report', short: 'Terrorist financing', kind: 'activity', urgent: true, hint: 'Terrorist-financing indicators. File without delay; assess an asset freeze.' },
};
export const FIU_TYPE_CODES = Object.keys(FIU_TYPES);
export const THRESHOLD_TYPES = FIU_TYPE_CODES.filter((t) => FIU_TYPES[t].threshold);

/** Legacy objective / subjective rows read as UTR. */
export const normaliseType = (t) => (FIU_TYPES[t] ? t : 'UTR');
const LEGACY_SUFFIX = { unusual_objective: ' · objective', unusual_subjective: ' · subjective' };
/** "UTR · objective", "CTR", … */
export const typeCode = (t) => `${normaliseType(t)}${LEGACY_SUFFIX[t] || ''}`;
export const typeLabel = (t) => `${FIU_TYPES[normaliseType(t)].label}${LEGACY_SUFFIX[t] || ''}`;

export const enabledTypes = (fiu) => {
  const list = (fiu?.enabled_report_types || []).filter((t) => FIU_TYPES[t]);
  return list.length ? list : FIU_TYPE_CODES;
};

export const ORIGIN_LABEL = {
  tm_case: 'TM case', alert: 'Alert', kyc_case: 'KYC case', manual: 'Manual', auto_threshold: 'Auto: threshold', auto_tf: 'Auto: TF signal',
};
