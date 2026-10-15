// Validation helpers for BankAccount maintenance (backend only).
import { httpError } from './tmAuth.js';

export const acctNorm = (v) => String(v ?? '').toUpperCase().replace(/[\s-]/g, '');
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const IBAN_LIKE = /^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/;

/** ISO 13616 mod-97 checksum. */
export function ibanChecksumOk(iban) {
  const moved = iban.slice(4) + iban.slice(0, 4);
  let rem = 0;
  for (const ch of moved) {
    const digits = ch >= 'A' && ch <= 'Z' ? String(ch.charCodeAt(0) - 55) : ch;
    for (const d of digits) rem = (rem * 10 + Number(d)) % 97;
  }
  return rem === 1;
}

/** Returns the stored form of the account number. IBAN-looking values are normalised and checksum-validated. */
export function cleanAccountNumber(value) {
  const raw = String(value ?? '').trim();
  if (!raw) throw httpError(400, 'iban_or_number is required');
  const n = acctNorm(raw);
  if (IBAN_LIKE.test(n)) {
    if (!ibanChecksumOk(n)) throw httpError(422, 'This IBAN is not valid (checksum failed)');
    return n;
  }
  return raw;
}

const SOURCES = ['api', 'psd2', 'upload', 'manual'];
const FREQS = ['daily', 'weekly', 'monthly'];

export function requireDate(v, name) {
  if (!DATE_RE.test(String(v ?? '')) || Number.isNaN(new Date(`${v}T00:00:00Z`).getTime())) throw httpError(400, `${name} must be YYYY-MM-DD`);
  return v;
}

/** Whitelisted, validated account fields from a payload. Empty optional values are left out. */
export function pickFields(p) {
  const out = {};
  const str = (k) => { const v = typeof p[k] === 'string' ? p[k].trim() : ''; if (v) out[k] = v; };
  if (p.iban_or_number !== undefined) out.iban_or_number = cleanAccountNumber(p.iban_or_number);
  ['institution', 'holder_name'].forEach(str);
  if (typeof p.bic === 'string' && p.bic.trim()) {
    const bic = p.bic.trim().toUpperCase();
    if (!/^[A-Z0-9]{8}([A-Z0-9]{3})?$/.test(bic)) throw httpError(400, 'BIC must be 8 or 11 characters');
    out.bic = bic;
  }
  if (typeof p.currency === 'string' && p.currency.trim()) {
    const c = p.currency.trim().toUpperCase();
    if (!/^[A-Z]{3}$/.test(c)) throw httpError(400, 'currency must be a 3-letter code');
    out.currency = c;
  }
  if (p.source_type !== undefined && p.source_type !== '') {
    if (!SOURCES.includes(p.source_type)) throw httpError(400, 'Invalid source_type');
    out.source_type = p.source_type;
  }
  if (p.expected_frequency !== undefined && p.expected_frequency !== '') {
    if (!FREQS.includes(p.expected_frequency)) throw httpError(400, 'Invalid expected_frequency');
    out.expected_frequency = p.expected_frequency;
  }
  if (p.is_customer_owned !== undefined) out.is_customer_owned = p.is_customer_owned === true;
  if (p.opened_at) out.opened_at = requireDate(p.opened_at, 'opened_at');
  return out;
}

export const snapshot = (a) => ({
  iban_or_number: a.iban_or_number, institution: a.institution, bic: a.bic, currency: a.currency, holder_name: a.holder_name,
  source_type: a.source_type, is_customer_owned: a.is_customer_owned, expected_frequency: a.expected_frequency,
  opened_at: a.opened_at, status: a.status, closed_at: a.closed_at, closed_reason: a.closed_reason,
});