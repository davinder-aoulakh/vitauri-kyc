// Guided conversation outreach: tenant settings (Tenant.outreach_settings, an object) and the feature flag.
// Pure: no I/O. A copy lives in src/lib (tests/shared-copies.test.js). Keys are never stored here: they live in TenantSecret.
// Defaults are the pack values (spec 4.1, plan section 5); Curaçao (+599) is added to the phone and address lists (plan decision 8).

export const OUTREACH_FLAG = 'outreach_conversation';

function flagsOf(tenant) {
  const raw = tenant?.features_enabled;
  if (!raw) return {};
  if (typeof raw === 'object') return raw;
  try { return JSON.parse(raw) || {}; } catch { return {}; }
}
/** The guided conversation is on for this tenant (default off). */
export function conversationOn(tenant) {
  return flagsOf(tenant)[OUTREACH_FLAG] === true;
}

export const OUTREACH_DEFAULTS = {
  uboThreshold: 25,
  ownerListThreshold: 10,
  releaseInvitesAfterIdv: true,
  defaultDeadlineDays: 14,
  tokenGraceDays: 7,
  reminderDays: [3, 7, 12],
  documentMaxAgeMonths: 3,
  aiFollowUp: { low: 'auto', medium: 'approval', high: 'approval' },
  aiFollowUpMaxPerRequest: 3,
  aiApprovalWaitMinutes: 60,
  idvMaxAttempts: 3,
  legalFormKeywords: {
    partnership: ['vennootschap onder firma', 'v.o.f.', 'commanditaire', 'c.v.', 'maatschap', 'partnership'],
    sole: ['eenmanszaak', 'sole proprietor'],
  },
  phoneCountryCodes: ['+44', '+31', '+353', '+49', '+1', '+599'],
  addressCountries: ['United Kingdom', 'Netherlands', 'Ireland', 'Curaçao'],
  blockedJurisdictions: [],
  referencePrefix: 'NAB',
  responseTimeTexts: { NP: '1 working day', ORG: '2 working days' },
  adapterCosts: {},
};

const num = (v, min, max, d) => { const n = Number(v); return Number.isFinite(n) && n >= min && n <= max ? n : d; };
const bool = (v, d) => (typeof v === 'boolean' ? v : d);
const strList = (v, d, max = 100) => (Array.isArray(v) ? [...new Set(v.map((x) => String(x ?? '').trim()).filter(Boolean))].slice(0, max) : d);
const MODES = ['auto', 'approval'];

/** The tenant's settings with defaults filled in. */
export function outreachSettings(tenant) {
  const s = tenant?.outreach_settings && typeof tenant.outreach_settings === 'object' ? tenant.outreach_settings : {};
  return cleanSettings(s).settings;
}

/**
 * Validates and normalises settings input. Returns { settings, errors }. Unknown keys are dropped (no secrets can be stored
 * this way); invalid values fall back to the default and are reported.
 */
export function cleanSettings(input = {}) {
  const d = OUTREACH_DEFAULTS;
  const i = input && typeof input === 'object' ? input : {};
  const errors = [];
  const pick = (key, value) => { if (i[key] !== undefined && JSON.stringify(value) !== JSON.stringify(i[key]) && JSON.stringify(value) === JSON.stringify(d[key])) errors.push(key); return value; };
  const ai = i.aiFollowUp && typeof i.aiFollowUp === 'object' ? i.aiFollowUp : {};
  const aiFollowUp = Object.fromEntries(Object.entries(d.aiFollowUp).map(([k, v]) => [k, MODES.includes(ai[k]) ? ai[k] : v]));
  if (i.aiFollowUp !== undefined && Object.keys(ai).some((k) => !MODES.includes(ai[k]))) errors.push('aiFollowUp');
  const kw = i.legalFormKeywords && typeof i.legalFormKeywords === 'object' ? i.legalFormKeywords : {};
  const reminderDays = Array.isArray(i.reminderDays)
    ? [...new Set(i.reminderDays.map(Number).filter((n) => Number.isInteger(n) && n > 0 && n <= 365))].sort((a, b) => a - b)
    : d.reminderDays;
  const rt = i.responseTimeTexts && typeof i.responseTimeTexts === 'object' ? i.responseTimeTexts : {};
  const settings = {
    uboThreshold: pick('uboThreshold', num(i.uboThreshold, 1, 100, d.uboThreshold)),
    ownerListThreshold: pick('ownerListThreshold', num(i.ownerListThreshold, 1, 100, d.ownerListThreshold)),
    releaseInvitesAfterIdv: pick('releaseInvitesAfterIdv', bool(i.releaseInvitesAfterIdv, d.releaseInvitesAfterIdv)),
    defaultDeadlineDays: pick('defaultDeadlineDays', num(i.defaultDeadlineDays, 1, 365, d.defaultDeadlineDays)),
    tokenGraceDays: pick('tokenGraceDays', num(i.tokenGraceDays, 0, 90, d.tokenGraceDays)),
    reminderDays,
    documentMaxAgeMonths: pick('documentMaxAgeMonths', num(i.documentMaxAgeMonths, 1, 24, d.documentMaxAgeMonths)),
    aiFollowUp,
    aiFollowUpMaxPerRequest: pick('aiFollowUpMaxPerRequest', num(i.aiFollowUpMaxPerRequest, 0, 20, d.aiFollowUpMaxPerRequest)),
    aiApprovalWaitMinutes: pick('aiApprovalWaitMinutes', num(i.aiApprovalWaitMinutes, 1, 1440, d.aiApprovalWaitMinutes)),
    idvMaxAttempts: pick('idvMaxAttempts', num(i.idvMaxAttempts, 1, 10, d.idvMaxAttempts)),
    legalFormKeywords: {
      partnership: strList(kw.partnership, d.legalFormKeywords.partnership).map((x) => x.toLowerCase()),
      sole: strList(kw.sole, d.legalFormKeywords.sole).map((x) => x.toLowerCase()),
    },
    phoneCountryCodes: strList(i.phoneCountryCodes, d.phoneCountryCodes).filter((c) => /^\+\d{1,4}$/.test(c)),
    addressCountries: strList(i.addressCountries, d.addressCountries),
    blockedJurisdictions: strList(i.blockedJurisdictions, d.blockedJurisdictions),
    referencePrefix: /^[A-Z0-9]{1,8}$/.test(String(i.referencePrefix || '')) ? String(i.referencePrefix) : pick('referencePrefix', d.referencePrefix),
    responseTimeTexts: { NP: String(rt.NP || d.responseTimeTexts.NP).slice(0, 80), ORG: String(rt.ORG || d.responseTimeTexts.ORG).slice(0, 80) },
    adapterCosts: i.adapterCosts && typeof i.adapterCosts === 'object'
      ? Object.fromEntries(Object.entries(i.adapterCosts).filter(([, v]) => Number.isFinite(Number(v)) && Number(v) >= 0).map(([k, v]) => [String(k).slice(0, 60), Number(v)]))
      : d.adapterCosts,
  };
  if (!settings.phoneCountryCodes.length) settings.phoneCountryCodes = d.phoneCountryCodes;
  if (!settings.addressCountries.length) settings.addressCountries = d.addressCountries;
  if (!settings.reminderDays.length && Array.isArray(i.reminderDays) && i.reminderDays.length) errors.push('reminderDays');
  return { settings, errors: [...new Set(errors)] };
}

/** Company registry in use for a tenant: KvK for the Netherlands only when the KvK mode is test or live. */
export function registryProvider(kvkMode) {
  return kvkMode === 'test' || kvkMode === 'live' ? { nl: 'kvk', other: 'didit', label: kvkMode === 'test' ? 'KvK for the Netherlands (test)' : 'KvK for the Netherlands' } : { nl: 'didit', other: 'didit', label: 'Didit (default)' };
}
