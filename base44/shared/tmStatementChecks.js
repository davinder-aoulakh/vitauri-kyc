// Integrity checks for parsed statements: balance reconciliation, coverage gaps, tamper signals.
import { round2 } from './tmStatementParse.js';

const TOL = 0.0105;
export const signed = (r) => (r.direction === 'inbound' ? 1 : -1) * r.amount;

/** Fills missing opening/closing from per-row balances and counts running-balance breaks. */
export function deriveBalances(rows, opening, closing) {
  const withBal = rows.filter((r) => typeof r.balance === 'number');
  const hasRowBalances = withBal.length > 0 && withBal.length >= rows.length * 0.8;
  let chainBreaks = 0;
  let o = opening; let c = closing;
  if (hasRowBalances) {
    const first = rows.find((r) => typeof r.balance === 'number');
    if (o === null || o === undefined) o = round2(first.balance - signed(first));
    if (c === null || c === undefined) c = [...rows].reverse().find((r) => typeof r.balance === 'number').balance;
    let prev = null;
    for (const r of rows) {
      if (typeof r.balance !== 'number') continue;
      if (prev !== null && Math.abs(prev + signed(r) - r.balance) > TOL) chainBreaks++;
      prev = r.balance;
    }
  }
  return { opening: o ?? null, closing: c ?? null, hasRowBalances, chainBreaks };
}

/** reconciles: true | false | null (cannot tell). */
export function reconcile(rows, opening, closing, chainBreaks = 0) {
  if (opening === null || closing === null) return { reconciles: null, diff: null };
  const sum = rows.reduce((s, r) => s + signed(r), 0);
  const diff = round2(opening + sum - closing);
  return { reconciles: Math.abs(diff) <= TOL && chainBreaks === 0, diff };
}

const dayAdd = (d, n) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);

/**
 * Runs of days inside the period with no rows. A run is a gap when the stated balance before and after differ
 * (per-row balances available), otherwise when the account is expected daily or the statement does not reconcile.
 */
export function findGaps({ rows, periodFrom, periodTo, opening, closing, hasRowBalances, expectedFrequency, reconciles }) {
  if (!rows.length) return [];
  const byDay = new Map();
  for (const r of rows) { if (!byDay.has(r.date)) byDay.set(r.date, []); byDay.get(r.date).push(r); }
  const days = [...byDay.keys()].sort();
  const from = periodFrom && periodFrom < days[0] ? periodFrom : days[0];
  const to = periodTo && periodTo > days[days.length - 1] ? periodTo : days[days.length - 1];
  const endBal = (d) => { const l = byDay.get(d); return typeof l[l.length - 1].balance === 'number' ? l[l.length - 1].balance : null; };
  const startBal = (d) => { const f = byDay.get(d)[0]; return typeof f.balance === 'number' ? round2(f.balance - signed(f)) : null; };
  const gaps = [];
  let runStart = null;
  const close = (end) => {
    if (!runStart) return;
    const prevDay = [...days].reverse().find((d) => d < runStart);
    const nextDay = days.find((d) => d > end);
    let isGap;
    const pb = prevDay ? endBal(prevDay) : opening;
    const nb = nextDay ? startBal(nextDay) : closing;
    if (hasRowBalances && pb !== null && pb !== undefined && nb !== null && nb !== undefined) isGap = Math.abs(pb - nb) > TOL;
    else isGap = expectedFrequency === 'daily' || reconciles === false;
    if (isGap) gaps.push({ from: runStart, to: end });
    runStart = null;
  };
  let d = from; let guard = 0;
  while (d <= to && guard++ < 800) {
    if (byDay.has(d)) close(dayAdd(d, -1));
    else if (!runStart) runStart = d;
    d = dayAdd(d, 1);
  }
  close(to);
  return gaps.slice(0, 200);
}

/** PDF only: signs that the document or its numbers were altered. */
export function tamperSignals({ chainBreaks, reconciles, diff, observations = [], statedCredits, statedDebits, rows }) {
  const out = [];
  if (chainBreaks > 0) out.push(`Running balance breaks at ${chainBreaks} row(s)`);
  if (reconciles === false && diff !== null) out.push(`Opening balance plus movements differs from the closing balance by ${diff}`);
  const sum = (dir) => round2(rows.filter((r) => r.direction === dir).reduce((s, r) => s + r.amount, 0));
  if (typeof statedCredits === 'number' && Math.abs(statedCredits - sum('inbound')) > TOL) out.push(`Stated total credits (${statedCredits}) do not match the rows (${sum('inbound')})`);
  if (typeof statedDebits === 'number' && Math.abs(statedDebits - sum('outbound')) > TOL) out.push(`Stated total debits (${statedDebits}) do not match the rows (${sum('outbound')})`);
  for (const o of observations) if (o) out.push(`Document: ${String(o).slice(0, 200)}`);
  return out;
}