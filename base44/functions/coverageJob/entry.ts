// coverageJob — daily TM data-coverage check (scheduled, service role).
// Scheduler calls it without a user and processes every tenant with tm_core enabled.
// A signed-in caller may only run it for their own tenant (Vitauri Ops: all tenants).
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.52';
import { isTmEnabled } from '../../shared/tmGuards.js';
import { asList, chunk, mapLimit, errorResponse, httpError } from '../../shared/tmAuth.js';
import { addDays, daysBetween, fetchAll, planAccount, toIso } from '../../shared/tmCoverage.js';

const CALLER_ROLES = ['Vitauri Ops', 'Tenant Admin', 'Compliance Admin', 'Compliance Officer'];
const RECIPIENT_ROLES = ['Compliance Officer', 'Tenant Admin'];
const OPEN_ALERT = ['new', 'triaged', 'in_review', 'escalated'];
const CLOSED_ALERT = ['closed_false_positive', 'closed_no_action', 'reported'];
const STALL_DAYS = 2;
const REAUTH_DAYS = 14;
const WINDOW_DAYS = 35;
const DAY_MS = 86400000;

async function processTenant(base44, tenant, todayStr, nowMs) {
  const E = base44.asServiceRole.entities;
  const tid = tenant.id;
  const yesterday = addDays(todayStr, -1);
  const floor = addDays(todayStr, -WINDOW_DAYS);

  const accounts = await fetchAll((cursor) => E.BankAccount.filter({ tenant_id: tid, status: 'active' }, { limit: 1000, cursor }));
  const rows = await fetchAll((cursor) => E.CoverageDay.filter({ tenant_id: tid, date: { $gte: floor, $lte: yesterday } }, { sort: 'date', limit: 1000, cursor }), 20);
  const prior = asList(await E.CoverageDay.filter({ tenant_id: tid, date: { $lt: floor }, txn_count: { $gt: 0 } }, { sort: '-date', limit: 1000 }));

  const rowsByAccount = new Map();
  for (const r of rows) {
    if (!rowsByAccount.has(r.bank_account_id)) rowsByAccount.set(r.bank_account_id, new Map());
    rowsByAccount.get(r.bank_account_id).set(r.date, r);
  }
  const priorByAccount = new Map();
  for (const r of prior) if (!priorByAccount.has(r.bank_account_id)) priorByAccount.set(r.bank_account_id, r.date);

  // Days that still hold transactions under review: linked to an open alert, or Didit IN_REVIEW without a closed alert.
  const openAlerts = await fetchAll((cursor) => E.TmAlert.filter({ tenant_id: tid, status: { $in: OPEN_ALERT } }, { limit: 1000, cursor }), 5);
  const closedAlerts = await fetchAll((cursor) => E.TmAlert.filter({ tenant_id: tid, status: { $in: CLOSED_ALERT } }, { limit: 1000, cursor }), 5);
  const closedTxn = new Set(closedAlerts.flatMap((a) => a.transaction_ids || []));
  const blockedIds = new Set(openAlerts.flatMap((a) => a.transaction_ids || []));
  const blockedTxns = [];
  for (const c of chunk([...blockedIds], 100)) {
    blockedTxns.push(...asList(await E.Transaction.filter({ tenant_id: tid, id: { $in: c } }, undefined, 100)));
  }
  const inReview = await fetchAll((cursor) => E.Transaction.filter({ tenant_id: tid, status: 'IN_REVIEW', coverage_date: { $gte: floor, $lte: yesterday } }, { limit: 1000, cursor }), 5);
  blockedTxns.push(...inReview.filter((t) => !closedTxn.has(t.id)));
  const blockedByAccount = new Map();
  for (const t of blockedTxns) {
    if (!t.bank_account_id || !t.coverage_date) continue;
    if (!blockedByAccount.has(t.bank_account_id)) blockedByAccount.set(t.bank_account_id, new Set());
    blockedByAccount.get(t.bank_account_id).add(t.coverage_date);
  }

  // ── CoverageDay rows ──
  const toCreate = [];
  const toUpdate = [];
  const accountsWithMissing = [];
  const lastReceiptByAccount = new Map();
  for (const account of accounts) {
    const plan = planAccount({
      account, rowsByDate: rowsByAccount.get(account.id) || new Map(), priorReceipt: priorByAccount.get(account.id),
      floor, yesterday, today: todayStr, blockedDates: blockedByAccount.get(account.id) || new Set(),
    });
    toCreate.push(...plan.create.map((r) => ({ ...r, tenant_id: tid })));
    toUpdate.push(...plan.update);
    lastReceiptByAccount.set(account.id, plan.lastReceipt);
    if (plan.missing > 0) accountsWithMissing.push({ account, missing: plan.missing });
  }
  for (const group of chunk(toCreate, 200)) await E.CoverageDay.bulkCreate(group);
  await mapLimit(toUpdate, 6, (u) => E.CoverageDay.update(u.id, u.patch));

  // ── Connections: stalled + expiring PSD2 consents ──
  const connections = await fetchAll((cursor) => E.BankConnection.filter({ tenant_id: tid }, { limit: 1000, cursor }), 5);
  const accountById = new Map(accounts.map((a) => [a.id, a]));
  const stalled = [];
  const stalledAccountIds = new Set();
  const newlyExpiring = [];
  let expiringTotal = 0;
  for (const conn of connections) {
    const account = accountById.get(conn.bank_account_id);
    if (!account || !['active', 'expiring'].includes(conn.consent_status)) continue;
    const ref = conn.last_sync_at || conn.consent_granted_at;
    if (ref && nowMs - new Date(ref).getTime() > STALL_DAYS * DAY_MS) {
      stalled.push({ account, reason: conn.last_sync_at ? 'no sync for over 2 days' : 'never synced' });
      stalledAccountIds.add(account.id);
    }
    const due = conn.reauth_due_at ? new Date(conn.reauth_due_at).getTime() : null;
    if (conn.consent_status === 'active' && due !== null && due <= nowMs + REAUTH_DAYS * DAY_MS) newlyExpiring.push(conn);
    if (conn.consent_status === 'expiring') expiringTotal++;
  }
  await mapLimit(newlyExpiring, 6, (c) => E.BankConnection.update(c.id, { consent_status: 'expiring' }));
  expiringTotal += newlyExpiring.length;
  for (const account of accounts) {
    if (account.source_type !== 'api' || stalledAccountIds.has(account.id)) continue;
    const last = lastReceiptByAccount.get(account.id) || account.opened_at;
    if (last && daysBetween(last, todayStr) > STALL_DAYS) stalled.push({ account, reason: 'no transactions for over 2 days' });
  }

  // ── Summary notification (Compliance Officers + Tenant Admins) ──
  const users = asList(await E.User.filter({ tenant_id: tid }, undefined, 1000));
  const recipients = users.filter((u) => RECIPIENT_ROLES.includes(u.app_role || u.data?.app_role) && (u.is_active ?? u.data?.is_active) !== false);
  const label = (a) => a.holder_name ? `${a.holder_name} (${a.iban_or_number})` : a.iban_or_number;
  const lines = [
    `Accounts with missing days: ${accountsWithMissing.length}${accountsWithMissing.length ? ` — ${accountsWithMissing.slice(0, 5).map((x) => `${label(x.account)} (${x.missing})`).join(', ')}${accountsWithMissing.length > 5 ? '…' : ''}` : ''}`,
    `Stalled connections: ${stalled.length}${stalled.length ? ` — ${stalled.slice(0, 5).map((x) => label(x.account)).join(', ')}${stalled.length > 5 ? '…' : ''}` : ''}`,
    `Consents expiring within ${REAUTH_DAYS} days: ${expiringTotal}`,
  ];
  const title = `TM data coverage — ${todayStr}`;
  const already = new Set(asList(await E.Notification.filter({ tenant_id: tid, type: 'tm_coverage_summary', title }, undefined, 1000)).map((n) => n.user_id));
  const fresh = recipients.filter((u) => !already.has(u.id));
  if (fresh.length) {
    await E.Notification.bulkCreate(fresh.map((u) => ({ tenant_id: tid, user_id: u.id, type: 'tm_coverage_summary', title, body: lines.join('\n'), is_read: false })));
  }

  const summary = {
    accounts: accounts.length, accounts_with_missing_days: accountsWithMissing.length, stalled_connections: stalled.length,
    expiring_consents: expiringTotal, rows_created: toCreate.length, rows_updated: toUpdate.length, notified: fresh.length,
  };
  await E.AuditEvent.create({
    tenant_id: tid, actor_type: 'System', actor_name: 'coverageJob', event_type: 'tm_coverage_check',
    before_state: {}, after_state: { ...summary, consents_set_expiring: newlyExpiring.map((c) => c.id) },
    notes: `Daily TM coverage check ${todayStr}: ${lines.join('; ')}`,
  });
  return { tenant_id: tid, ...summary };
}

export default async function (req) {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me().catch(() => null);
    let onlyTenant = null;
    if (user) {
      const role = user.app_role || user.data?.app_role;
      if (!CALLER_ROLES.includes(role)) throw httpError(403, 'Forbidden');
      if (role !== 'Vitauri Ops') {
        onlyTenant = user.tenant_id || user.data?.tenant_id;
        if (!onlyTenant) throw httpError(403, 'No tenant associated with this user');
      }
    }

    const now = new Date();
    const todayStr = toIso(now);
    const tenants = asList(await base44.asServiceRole.entities.Tenant.list('-created_date', 1000))
      .filter((t) => t.status !== 'Suspended' && isTmEnabled(t, 'tm_core') && (!onlyTenant || t.id === onlyTenant));

    const results = [];
    for (const tenant of tenants) {
      try {
        results.push(await processTenant(base44, tenant, todayStr, now.getTime()));
      } catch (e) {
        results.push({ tenant_id: tenant.id, error: String(e?.message || e).slice(0, 300) });
      }
    }
    return Response.json({ date: todayStr, tenants: results.length, results });
  } catch (error) {
    return errorResponse(error);
  }
}