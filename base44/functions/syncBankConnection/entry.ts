// syncBankConnection — PSD2 pull. Scheduled every 6 hours (no user: every tenant with tm_core) or on demand
// (tmWorkCase user: own tenant, optional { connection_id }). Active/expiring connections only.
// 'manual' adapter: the 501 is recorded as last_error and last_sync_at is set to the attempt time, so the connection
// is not reported as stalled. Real adapters return rows that are pushed to normaliseTransactions with channel 'psd2'.
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.52';
import { isTmEnabled } from '../../shared/tmGuards.js';
import { asList, chunk, errorResponse, httpError, WORK_ROLES } from '../../shared/tmAuth.js';
import { writeAudit } from '../../shared/tmAudit.js';
import { getAdapter } from '../../shared/psd2Adapter.js';

const MAX_ITEMS = 200;

async function syncOne(base44, ctx, conn, account, pushRows) {
  const E = base44.asServiceRole.entities;
  const now = new Date().toISOString();
  try {
    const rows = await getAdapter(conn.partner).listTransactions(ctx, {
      consentId: conn.consent_id, accountRef: account.iban_or_number, from: conn.last_sync_at || conn.consent_granted_at, to: now,
    });
    const items = (rows || []).map((r) => ({ ...r, client_id: account.client_id, bank_account_id: account.id, iban_or_number: account.iban_or_number }));
    for (const part of chunk(items, MAX_ITEMS)) await pushRows(part);
    await E.BankConnection.update(conn.id, { last_sync_at: now, last_error: '' });
    return { id: conn.id, ok: true, rows: items.length };
  } catch (e) {
    const detail = String(e?.detail || e?.message || e).slice(0, 300);
    await E.BankConnection.update(conn.id, e?.status === 501 ? { last_sync_at: now, last_error: detail } : { last_error: detail });
    return { id: conn.id, ok: false, status: e?.status || 500, error: detail };
  }
}

async function processTenant(base44, tenant, connectionId, actor, pushRows) {
  const E = base44.asServiceRole.entities;
  const tid = tenant.id;
  const query = { tenant_id: tid, consent_status: { $in: ['active', 'expiring'] }, ...(connectionId ? { id: connectionId } : {}) };
  const conns = asList(await E.BankConnection.filter(query, undefined, 1000));
  const results = [];
  for (const conn of conns) {
    const account = asList(await E.BankAccount.filter({ tenant_id: tid, id: conn.bank_account_id }))[0];
    if (!account || account.status === 'closed') continue;
    results.push(await syncOne(base44, { base44, tenantId: tid, tenant }, conn, account, pushRows(tid)));
  }
  if (results.length) {
    const ok = results.filter((r) => r.ok).length;
    await writeAudit(base44, actor, {
      tenantId: tid, eventType: 'tm_bank_connections_synced', before: {},
      after: { connections: results.length, succeeded: ok, failed: results.length - ok, rows: results.reduce((n, r) => n + (r.rows || 0), 0) },
      notes: `PSD2 sync: ${results.length} connection(s), ${ok} succeeded.`,
    });
  }
  return { tenant_id: tid, connections: results.length, results };
}

export default async function (req) {
  try {
    const base44 = createClientFromRequest(req);
    const body = await req.json().catch(() => ({}));
    const user = await base44.auth.me().catch(() => null);
    let onlyTenant = null;
    let actor = { actorType: 'System', actorName: 'PSD2 Sync', actorUserId: undefined };
    if (user) {
      const role = user.app_role || user.data?.app_role;
      if (!WORK_ROLES.includes(role)) throw httpError(403, 'Forbidden');
      onlyTenant = user.tenant_id || user.data?.tenant_id;
      if (!onlyTenant) throw httpError(403, 'No tenant associated with this user');
      actor = { actorType: 'User', actorName: user.full_name || user.email, actorUserId: user.id };
    }
    // Rows go through normaliseTransactions (channel 'psd2'), as the caller when a user triggered the sync.
    const pushRows = (tid) => async (items) => {
      const invoke = user ? base44.functions : base44.asServiceRole.functions;
      const res = await invoke.invoke('normaliseTransactions', { tenant_id: tid, channel: 'psd2', items });
      const data = res?.data ?? res;
      if (data?.error) throw new Error(data.error);
    };

    const tenants = asList(await base44.asServiceRole.entities.Tenant.list('-created_date', 1000))
      .filter((t) => t.status !== 'Suspended' && isTmEnabled(t, 'tm_core') && (!onlyTenant || t.id === onlyTenant));
    const results = [];
    for (const tenant of tenants) {
      try { results.push(await processTenant(base44, tenant, onlyTenant ? body.connection_id : undefined, actor, pushRows)); } catch (e) {
        results.push({ tenant_id: tenant.id, error: String(e?.message || e).slice(0, 300) });
      }
    }
    return Response.json({ tenants: results.length, results });
  } catch (error) {
    console.error('syncBankConnection error:', error?.message);
    return errorResponse(error);
  }
}