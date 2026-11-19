// Guided conversation outreach: the legal form kind (company | partnership | sole) that conditions and the owners question use.
// Keywords come from the tenant settings (legalFormKeywords); anything else counts as a company. Pure.
import { OUTREACH_DEFAULTS } from './outreachSettings.js';

const fold = (s) => ` ${String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim()} `;

export function legalFormKind(text, keywords = OUTREACH_DEFAULTS.legalFormKeywords) {
  const t = fold(text);
  if (!t.trim()) return null;
  const has = (list) => (list || []).some((k) => {
    const kk = String(k).toLowerCase().trim();
    if (!kk) return false;
    const plain = kk.replace(/\./g, '');
    return t.includes(` ${kk} `) || t.includes(kk.length > 4 ? kk : ` ${kk}`) || t.replace(/\./g, '').includes(` ${plain} `);
  });
  if (has(keywords?.sole)) return 'sole';
  if (has(keywords?.partnership)) return 'partnership';
  return 'company';
}
