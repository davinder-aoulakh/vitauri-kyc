// Bulk import (phase 8, gaps G8-G10): one file, many statements, matched to accounts on IBAN. Pure: no I/O.
import { parseMt940, parseCamt053 } from './tmStatementParse.js';

export const BULK_FORMATS = ['mt940', 'camt053'];
export const MAX_BULK_ACCOUNTS = 25;
export const ibanNorm = (v) => String(v ?? '').toUpperCase().replace(/[\s-]/g, '');

/** One parse result per statement in the file (same shape as parseMt940 / parseCamt053 return for a single statement). */
export function parseStatements(format, text) {
  const src = String(text || '');
  if (format === 'mt940') {
    return src.replace(/\r/g, '').split(/\n(?=:20:)/).filter((c) => /:25:/.test(c)).map((c) => parseMt940(c));
  }
  if (format === 'camt053') {
    const re = /<(?:[A-Za-z0-9_]+:)?Stmt(?:\s[^>]*)?>[\s\S]*?<\/(?:[A-Za-z0-9_]+:)?Stmt>/g;
    const blocks = src.match(re) || [];
    if (!blocks.length) throw new Error('No Stmt element found. Is this a CAMT.053 file?');
    return blocks.map((b) => parseCamt053(b));
  }
  throw new Error('Bulk import reads MT940 and CAMT.053 files');
}

/**
 * Statements of the same account become one: a file often holds one statement per day. The opening balance is the
 * earliest statement's, the closing balance the latest's; rows keep their order. Statements without an account
 * reference are returned under iban '' (they cannot be matched).
 */
export function groupByAccount(statements) {
  const by = new Map();
  for (const s of statements || []) {
    const key = ibanNorm(s.account_ref);
    if (!by.has(key)) by.set(key, []);
    by.get(key).push(s);
  }
  const out = [];
  for (const [iban, list] of by) {
    const sorted = [...list].sort((a, b) => String(a.period_from || a.period_to || '').localeCompare(String(b.period_from || b.period_to || '')));
    const rows = sorted.flatMap((s) => s.rows || []);
    const dates = rows.map((r) => r.date).filter(Boolean).sort();
    const first = sorted.find((s) => s.opening !== null && s.opening !== undefined);
    const last = [...sorted].reverse().find((s) => s.closing !== null && s.closing !== undefined);
    out.push({
      iban, account_ref: sorted[0].account_ref || undefined, currency: sorted.find((s) => s.currency)?.currency,
      period_from: sorted.map((s) => s.period_from).filter(Boolean).sort()[0] || dates[0],
      period_to: sorted.map((s) => s.period_to).filter(Boolean).sort().pop() || dates[dates.length - 1],
      opening: first ? first.opening : null, closing: last ? last.closing : null,
      rows, statements: sorted.length,
    });
  }
  return out;
}

/** The merged statement for one IBAN, in the shape parseStatement expects, or null. */
export function pickAccount(groups, iban) {
  const g = (groups || []).find((x) => x.iban && x.iban === ibanNorm(iban));
  if (!g) return null;
  return { account_ref: g.account_ref, currency: g.currency, period_from: g.period_from, period_to: g.period_to, opening: g.opening, closing: g.closing, rows: g.rows };
}

/**
 * Match each statement to a monitored account on IBAN.
 * matched: [{ group, account }]. unmatched: [{ group, reason }] with reason 'unknown_iban', 'ambiguous' (the IBAN is
 * registered for more than one customer), 'no_account_reference' or 'no_transactions'. Closed accounts do not match.
 */
export function matchAccounts(groups, accounts) {
  const byIban = new Map();
  for (const a of accounts || []) {
    if (a.status === 'closed') continue;
    const k = ibanNorm(a.iban_or_number);
    if (!k) continue;
    if (!byIban.has(k)) byIban.set(k, []);
    byIban.get(k).push(a);
  }
  const matched = []; const unmatched = [];
  for (const g of groups || []) {
    if (!g.rows.length) { unmatched.push({ group: g, reason: 'no_transactions' }); continue; }
    if (!g.iban) { unmatched.push({ group: g, reason: 'no_account_reference' }); continue; }
    const hits = byIban.get(g.iban) || [];
    const clients = new Set(hits.map((a) => a.client_id));
    if (!hits.length) unmatched.push({ group: g, reason: 'unknown_iban' });
    else if (clients.size > 1) unmatched.push({ group: g, reason: 'ambiguous' });
    else matched.push({ group: g, account: hits[0] });
  }
  return { matched, unmatched };
}

/** A parsed statement may be processed without a person looking at it: no blocking check and the balance does not fail. */
export const autoCommittable = (parseResult) => !(parseResult?.blocking || []).length && parseResult?.reconciles !== false;

/**
 * Manual transaction (G10, spec test 14): with the KYC + AML layout it needs the customer's account and an execution
 * date that is not in the future. Returns { error } or { bank_account_id, executed_at } (ISO); both null when not
 * required and not given.
 */
export function manualTxnCheck(body, { v2, now = new Date() } = {}) {
  const accountId = String(body?.bank_account_id || '').trim();
  const raw = body?.executed_at;
  if (!v2 && !accountId && !raw) return { bank_account_id: null, executed_at: null };
  if (v2 && !accountId) return { error: 'The account is required' };
  if (v2 && !raw) return { error: 'The execution date is required' };
  let iso = null;
  if (raw) {
    const d = new Date(raw);
    if (Number.isNaN(d.getTime())) return { error: 'The execution date is not a valid date' };
    if (d.getTime() > now.getTime() + 5 * 60000) return { error: 'The execution date cannot be in the future' };
    iso = d.toISOString();
  }
  return { bank_account_id: accountId || null, executed_at: iso };
}
