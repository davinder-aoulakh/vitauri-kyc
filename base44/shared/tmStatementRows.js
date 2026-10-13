// Row keys + commit item building for statement uploads. Mirrors the dedupe logic in normaliseTransactions
// (sig = client|account|day|amount|currency|description, seq = index among identical sigs).
import { dedupeKey, normaliseDescription } from './tmCanonical.js';
import { parseDate, round2 } from './tmStatementParse.js';

// Midday UTC keeps the tenant-timezone coverage date equal to the statement date.
export const execAt = (date) => `${date}T12:00:00.000Z`;

export const sigOf = (clientId, accountId, r) => [
  clientId, accountId ?? '', r.date, Math.abs(Number(r.amount)).toFixed(2),
  String(r.currency || '').toUpperCase(), normaliseDescription(r.description),
].join('|');

/** Sets seq + dedupe_key on every row (in place). */
export async function assignKeys({ tenantId, clientId, accountId, rows }) {
  const counter = new Map();
  for (const r of rows) {
    const sig = sigOf(clientId, accountId, r);
    const seq = counter.get(sig) ?? 0;
    counter.set(sig, seq + 1);
    r.seq = seq;
    r.dedupe_key = await dedupeKey({
      tenant_id: tenantId, bank_account_id: accountId, executed_at: execAt(r.date),
      amount: r.amount, currency: r.currency, description_raw: r.description, seq,
    });
  }
  return rows;
}

/** Applies analyst edits: { [idx]: { exclude, date, description, amount, direction } }. Edited rows lose their duplicate flag. */
export function applyOverrides(rows, overrides = {}) {
  return rows.map((r) => {
    const o = overrides?.[r.idx];
    if (!o || typeof o !== 'object') return r;
    const next = { ...r };
    let edited = false;
    if (o.date !== undefined) { const d = parseDate(o.date); if (d) { next.date = d; edited = true; } }
    if (o.description !== undefined) { next.description = String(o.description).slice(0, 500); edited = true; }
    if (o.amount !== undefined && Number(o.amount) > 0) { next.amount = round2(Number(o.amount)); edited = true; }
    if (o.direction === 'inbound' || o.direction === 'outbound') { next.direction = o.direction; edited = true; }
    if (edited) next.duplicate = false;
    if (o.exclude === true) next.excluded = true;
    return next;
  });
}

/**
 * Items for normaliseTransactions. Duplicates and excluded rows are removed, except a duplicate that has a
 * later identical row we keep (dropping it would shift that row's seq onto the duplicate's key).
 */
export function buildItems({ clientId, accountId, accountRef, currency, rows }) {
  const sigs = rows.map((r) => sigOf(clientId, accountId, r));
  const keep = rows.map((r, i) => {
    if (r.excluded) return false;
    if (!r.duplicate) return true;
    return rows.some((o, j) => j > i && sigs[j] === sigs[i] && !o.duplicate && !o.excluded);
  });
  const kept = rows.map((r, i) => ({ r, sig: sigs[i] })).filter((_, i) => keep[i]);
  return kept.map(({ r, sig }) => ({
    sig,
    item: {
      client_id: clientId,
      executed_at: execAt(r.date),
      amount: r.amount,
      direction: r.direction,
      currency: r.currency || currency,
      description_raw: r.description,
      lifecycle: r.lifecycle || 'booked',
      counterparty_name: r.counterparty_name,
      counterparty_account_id: r.counterparty_account_id,
      ...(accountId ? { bank_account_id: accountId } : accountRef ? { iban_or_number: accountRef, account_currency: currency } : {}),
    },
  }));
}

/** Splits built items into calls of at most `size`, never separating rows with the same signature (seq must stay stable). */
export function chunkBySig(built, size) {
  const groups = new Map();
  for (const b of built) { if (!groups.has(b.sig)) groups.set(b.sig, []); groups.get(b.sig).push(b.item); }
  const chunks = [];
  let cur = [];
  for (const g of groups.values()) {
    if (cur.length && cur.length + g.length > size) { chunks.push(cur); cur = []; }
    cur.push(...g);
  }
  if (cur.length) chunks.push(cur);
  return chunks;
}