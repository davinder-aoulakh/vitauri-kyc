// Client-side helpers for the TM coverage page. Mirrors the rules in base44/shared/tmCoverage.js.
const DAY_MS = 86400000;
export const STALL_DAYS = 2;
export const REAUTH_DAYS = 14;
export const STRIP_DAYS = 30;

export const toIso = (d) => d.toISOString().slice(0, 10);
export const addDays = (s, n) => toIso(new Date(new Date(`${s}T00:00:00Z`).getTime() + n * DAY_MS));
export const daysBetween = (a, b) => Math.round((new Date(`${b}T00:00:00Z`) - new Date(`${a}T00:00:00Z`)) / DAY_MS);

export async function fetchAll(run, maxPages = 5) {
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

export function monthOptions(count = 12) {
  const now = new Date();
  return Array.from({ length: count }, (_, i) => {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    return { value: d.toISOString().slice(0, 7), label: d.toLocaleDateString(undefined, { month: 'long', year: 'numeric', timeZone: 'UTC' }) };
  });
}

/** month 'YYYY-MM' -> calendar bounds plus the 30-day strip window ending at min(month end, yesterday). */
export function coverageRange(month) {
  const [y, m] = month.split('-').map(Number);
  const monthStart = toIso(new Date(Date.UTC(y, m - 1, 1)));
  const monthEnd = toIso(new Date(Date.UTC(y, m, 0)));
  const yesterday = addDays(toIso(new Date()), -1);
  const end = monthEnd < yesterday ? monthEnd : yesterday;
  return { monthStart, monthEnd, end, start: addDays(end, -(STRIP_DAYS - 1)) };
}

export function stripCells(rows, start, end) {
  const byDate = new Map(rows.map((r) => [r.date, r]));
  const cells = [];
  for (let d = start; d <= end; d = addDays(d, 1)) {
    const r = byDate.get(d);
    let tone = 'none';
    let label = 'No record';
    if (r) {
      if (r.expected === false) { tone = 'none'; label = 'Not expected'; }
      else if (r.state === 'reviewed' || r.state === 'processed') { tone = 'green'; label = r.state === 'reviewed' ? 'Reviewed' : 'Processed'; }
      else if (r.state === 'received') { tone = 'lightgreen'; label = 'Received'; }
      else if (r.state === 'awaiting') { tone = 'amber'; label = 'Awaiting'; }
      else { tone = 'red'; label = 'Missing'; }
    }
    cells.push({ date: d, tone, label });
  }
  return cells;
}

function statusFor({ account, conn, lastReceipt, today }) {
  const sinceReceipt = lastReceipt ? daysBetween(lastReceipt, today) : null;
  if (conn) {
    const cs = conn.consent_status;
    if (cs === 'withdrawn') return { tone: 'red', label: 'Consent withdrawn' };
    if (cs === 'expired') return { tone: 'red', label: 'Consent expired' };
    if (cs === 'pending') return { tone: 'gray', label: 'Consent pending' };
    const ref = conn.last_sync_at || conn.consent_granted_at;
    const idle = ref ? Math.floor((Date.now() - new Date(ref).getTime()) / DAY_MS) : null;
    if (idle !== null && idle > STALL_DAYS) return { tone: 'red', label: `No data for ${idle} days`, stalled: true };
    const toReauth = conn.reauth_due_at ? Math.ceil((new Date(conn.reauth_due_at).getTime() - Date.now()) / DAY_MS) : null;
    if (cs === 'expiring' || (toReauth !== null && toReauth <= REAUTH_DAYS)) {
      return { tone: 'amber', label: toReauth !== null && toReauth < 0 ? 'Re-auth overdue' : `Re-auth due${toReauth !== null ? ` in ${toReauth} days` : ''}` };
    }
    return { tone: 'green', label: toReauth !== null ? `Consent active · ${toReauth} days to re-auth` : 'Consent active' };
  }
  if (account.source_type === 'api') {
    const ref = sinceReceipt ?? (account.opened_at ? daysBetween(account.opened_at, today) : null);
    if (ref !== null && ref > STALL_DAYS) return { tone: 'red', label: `No data for ${ref} days`, stalled: true };
    return { tone: 'green', label: 'Receiving data' };
  }
  return { tone: 'gray', label: account.source_type === 'upload' ? 'Statement upload' : 'Manual' };
}

/** Combine raw entity lists into the rows and KPI numbers the page shows. */
export function buildCoverageView({ accounts, rows, connections, uploads, clients, start, end, unreviewed, duplicates }) {
  const today = toIso(new Date());
  const clientName = new Map(clients.map((c) => [c.id, c.full_name]));
  const connByAccount = new Map(connections.map((c) => [c.bank_account_id, c]));
  const rowsByAccount = new Map();
  for (const r of rows) {
    if (!rowsByAccount.has(r.bank_account_id)) rowsByAccount.set(r.bank_account_id, []);
    rowsByAccount.get(r.bank_account_id).push(r);
  }
  const uploadByAccount = new Map();
  const uploadByClient = new Map();
  for (const u of uploads) {
    if (u.bank_account_id && !uploadByAccount.has(u.bank_account_id)) uploadByAccount.set(u.bank_account_id, u.committed_at);
    if (!uploadByClient.has(u.client_id)) uploadByClient.set(u.client_id, u.committed_at);
  }

  const accountRows = accounts.map((account) => {
    const accRows = rowsByAccount.get(account.id) || [];
    const cells = stripCells(accRows, start, end);
    const missing = accRows.filter((r) => r.expected !== false && r.state === 'missing').length;
    const lastReceipt = accRows.filter((r) => (r.txn_count || 0) > 0).map((r) => r.date).sort().pop() || null;
    const conn = connByAccount.get(account.id);
    return {
      account, conn, cells, missing, customer: clientName.get(account.client_id) || '—',
      status: statusFor({ account, conn, lastReceipt, today }),
      lastUpload: uploadByAccount.get(account.id) || uploadByClient.get(account.client_id) || null,
    };
  });

  return {
    accountRows,
    kpis: {
      accounts: accountRows.length,
      complete: accountRows.filter((r) => r.missing === 0).length,
      missingAccounts: accountRows.filter((r) => r.missing > 0).length,
      stalled: accountRows.filter((r) => r.status.stalled).length,
      unreviewed,
      duplicates,
    },
  };
}