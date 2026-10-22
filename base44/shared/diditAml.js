// Didit standalone AML (POST /v3/aml/) request helpers. Per docs.didit.me openapi-25:
// entity_type is 'person' | 'company'; nationality is ISO 3166-1 alpha-2 (an invalid code returns 400).
import { ISO3_MAP } from './diditDecision.js';

export const amlEntityType = (legalType) => (String(legalType || 'NP').toUpperCase() === 'ORG' ? 'company' : 'person');

const ISO3_TO_2 = Object.fromEntries(Object.entries(ISO3_MAP).map(([iso3, label]) => [iso3, (/\(([A-Z]{2})\)\s*$/.exec(label) || [])[1]]).filter(([, a2]) => a2));

/** 'AU', 'au', 'Australia (AU)' or 'AUS' → 'AU'; anything else → null (omit rather than send an invalid code). */
export function toAlpha2(value) {
  const v = String(value || '').trim();
  if (!v) return null;
  if (/^[A-Za-z]{2}$/.test(v)) return v.toUpperCase();
  const paren = /\(([A-Za-z]{2})\)\s*$/.exec(v);
  if (paren) return paren[1].toUpperCase();
  if (/^[A-Za-z]{3}$/.test(v)) return ISO3_TO_2[v.toUpperCase()] || null;
  return null;
}
