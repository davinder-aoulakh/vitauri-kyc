// Pure helpers for the daily TM coverage check. Dates are 'YYYY-MM-DD' strings (UTC).
const DAY_MS = 86400000;

export const toIso = (d) => d.toISOString().slice(0, 10);
export const parseIso = (s) => new Date(`${s}T00:00:00Z`);
export const addDays = (s, n) => toIso(new Date(parseIso(s).getTime() + n * DAY_MS));
export const daysBetween = (a, b) => Math.round((parseIso(b).getTime() - parseIso(a).getTime()) / DAY_MS);

export function addMonth(s) {
  const d = parseIso(s);
  const target = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(d.getUTCDate(), lastDay));
  return toIso(target);
}

export const addCycle = (s, freq) => (freq === 'weekly' ? addDays(s, 7) : addMonth(s));

export function monthEnd(s) {
  const d = parseIso(s);
  return toIso(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)));
}

/** Upload accounts: days of a statement period that is still open (or just closed) are 'awaiting', not 'missing'. */
const UPLOAD_GRACE_DAYS = 7;
function isAwaiting(account, day, today) {
  if (account.source_type !== 'upload') return false;
  return daysBetween(monthEnd(day), today) <= UPLOAD_GRACE_DAYS;
}

/** Page through a filter() call that supports cursors. run(cursor) -> array | {items, next_cursor, has_more}. */
export async function fetchAll(run, maxPages = 10) {
  const out = [];
  let cursor;
  for (let i = 0; i < maxPages; i++) {
    const page = await run(cursor);
    if (Array.isArray(page)) { out.push(...page); break; }
    out.push(...(page?.items || []));
    if (!page?.has_more) break;
    cursor = page.next_cursor;
  }
  return out;
}

/**
 * Plan CoverageDay changes for one account.
 * rowsByDate: Map<date, CoverageDay>; priorReceipt: last date before the window with data (or null);
 * blockedDates: Set<date> of days that still hold transactions under review (open alert or Didit IN_REVIEW without a closed alert).
 * Weekly/monthly accounts are expected only on cycle due dates, counted from the last day data was received.
 */
const periodStart = (d, freq) => (freq === 'weekly' ? addDays(d, -((parseIso(d).getUTCDay() + 6) % 7)) : `${d.slice(0, 7)}-01`);
const periodEnd = (d, freq) => (freq === 'weekly' ? addDays(periodStart(d, freq), 6) : monthEnd(d));
const hasData = (row) => !!row && ((row.txn_count || 0) > 0 || ['received', 'processed', 'reviewed'].includes(row.state));

/**
 * Daily accounts expect every day. Weekly accounts expect one day per ISO week (its Sunday), monthly accounts one per month
 * (its last day); that day is satisfied when any day of the period received data. Days before opened_at and after closed_at
 * are never expected. A period's expected day is only evaluated once it has passed (<= yesterday).
 */
export function planAccount({ account, rowsByDate, priorReceipt, floor, yesterday, today, blockedDates }) {
  const freq = account.expected_frequency || 'daily';
  const opened = account.opened_at || null;
  const closed = account.closed_at || null;
  const create = [];
  const update = [];
  let missing = 0;
  let lastReceipt = priorReceipt || null;
  const covered = new Set();
  if (freq !== 'daily') {
    if (priorReceipt) covered.add(periodStart(priorReceipt, freq));
    for (const [d, row] of rowsByDate) if (hasData(row)) covered.add(periodStart(d, freq));
  }

  for (let d = floor; d <= yesterday; d = addDays(d, 1)) {
    const row = rowsByDate.get(d);
    if (hasData(row)) {
      lastReceipt = d;
      if (row.state === 'processed' || row.state === 'reviewed') {
        const want = blockedDates.has(d) ? 'processed' : 'reviewed';
        if (want !== row.state) update.push({ id: row.id, patch: { state: want } });
      }
      continue;
    }
    if ((opened && d < opened) || (closed && d > closed)) {
      if (row && row.expected !== false) update.push({ id: row.id, patch: { expected: false } });
      continue;
    }
    let expected = true;
    if (freq !== 'daily') {
      const pe = periodEnd(d, freq);
      expected = d === (closed && closed < pe ? closed : pe);
    }
    const satisfied = expected && freq !== 'daily' && covered.has(periodStart(d, freq));
    const state = satisfied ? 'received' : (expected && isAwaiting(account, d, today) ? 'awaiting' : 'missing');
    if (expected && state === 'missing') missing++;
    if (!row) {
      create.push({
        bank_account_id: account.id, client_id: account.client_id, date: d, expected, state, txn_count: 0,
        source_type: account.source_type, ...(state === 'missing' && expected ? { gap_reason: 'no_data_received' } : {}),
      });
    } else if (row.expected !== expected || row.state !== state) {
      update.push({ id: row.id, patch: { expected, state } });
    }
  }
  return { create, update, missing, lastReceipt };
}