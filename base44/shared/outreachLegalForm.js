// Guided conversation outreach: the legal form kind (company | partnership | sole) that conditions and the owners question use.
// Keywords come from the tenant settings (legalFormKeywords); anything else counts as a company. Pure.
import { OUTREACH_DEFAULTS } from './outreachSettings.js';

const fold = (s) => ` ${String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\./g, '').replace(/[^a-z0-9]+/g, ' ').trim()} `;

export function legalFormKind(text, keywords = OUTREACH_DEFAULTS.legalFormKeywords) {
  const t = fold(text);
  if (!t.trim()) return null;
  const has = (list) => (list || []).some((k) => fold(k).trim() && t.includes(fold(k)));
  if (has(keywords?.sole)) return 'sole';
  if (has(keywords?.partnership)) return 'partnership';
  return 'company';
}
