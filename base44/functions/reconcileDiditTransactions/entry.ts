// reconcileDiditTransactions — nightly repair of Didit TM submissions that never got a confirmed answer.
// For rows with our_transaction_id and didit_submission_status failed/not_submitted older than 15 minutes:
//   1. look the txn_id up at Didit (recent pages of GET /v3/transactions/) → link uuid + status;
//   2. otherwise resubmit with the SAME transaction_id (Didit's idempotency key);
//   3. 400 (id already used) or 409 (concurrent duplicate) → search again; still not found → flag, never resend with a new id.
// Scheduler calls it without a user (all tm_core tenants). Vitauri Ops: all tenants; Tenant Admin: own tenant.
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.52';
import { isTmEnabled } from '../../shared/tmGuards.js';
import { asList, errorResponse, httpError, loadTenantWithDiditCredentials } from '../../shared/tmAuth.js';
import { postTransaction, buildTransactionBody, findTransactionByTxnId, diditTxnUuid, normaliseTxnStatus } from '../../shared/diditTm.js';
import { afterTransactionUpdate } from '../../shared/diditTxnActions.js';
import { writeAudit } from '../../shared/tmAudit.js';

const CALLER_ROLES = ['Vitauri Ops', 'Tenant Admin'];
const MIN_AGE_MS = 15 * 60 * 1000;
const MAX_PER_TENANT = 200;
const SYSTEM = { actorType: 'System', actorName: 'Didit Reconcile', actorUserId: undefined };

const errText = (e) => `${e?.status ? `HTTP ${e.status}: ` : ''}${typeof e?.detail === 'string' ? e.detail : JSON.stringify(e?.detail ?? e?.message ?? e)}`.slice(0, 500);

async function linkFound(base44, tenant, t, rec) {
  const status = normaliseTxnStatus(rec?.status, t.status || 'PENDING');
  await base44.asServiceRole.entities.Transaction.update(t.id, {
    didit_transaction_id: diditTxnUuid(rec) || t.didit_transaction_id || undefined,
    status, risk_score: rec?.score ?? rec?.risk_score ?? t.risk_score ?? null,
    risk_level: rec?.severity ?? rec?.risk_level ?? t.risk_level ?? null,
    decision_raw: rec, didit_submission_status: 'submitted', didit_submission_error: '',
  });
  try {
    await afterTransactionUpdate(base44, tenant, t, t.status, status, rec);
  } catch (e) {
    console.warn('reconcileDiditTransactions: afterTransactionUpdate failed', e?.message || e);
  }
}

async function reconcileOne(base44, tenant, t, clientCache) {
  const E = base44.asServiceRole.entities;
  const found = await findTransactionByTxnId(tenant, t.our_transaction_id);
  if (found) { await linkFound(base44, tenant, t, found); return 'linked'; }

  let client = clientCache.get(t.client_id);
  if (client === undefined) {
    client = asList(await E.Client.filter({ tenant_id: tenant.id, id: t.client_id }))[0] || null;
    clientCache.set(t.client_id, client);
  }
  if (!client) {
    await E.Transaction.update(t.id, { didit_submission_status: 'failed', didit_submission_error: 'Reconcile: client not found' });
    return 'unresolved';
  }

  try {
    const res = await postTransaction(tenant, buildTransactionBody(t, client, t.our_transaction_id, tenant.id, null));
    await linkFound(base44, tenant, t, res);
    return 'resubmitted';
  } catch (e) {
    if (e?.status === 400 || e?.status === 409) {
      const again = await findTransactionByTxnId(tenant, t.our_transaction_id, { pages: 10 });
      if (again) { await linkFound(base44, tenant, t, again); return 'linked'; }
    }
    await E.Transaction.update(t.id, { didit_submission_status: 'failed', didit_submission_error: `Reconcile: ${errText(e)}`.slice(0, 500) });
    return 'unresolved';
  }
}

async function processTenant(base44, tenantRow) {
  const tenant = await loadTenantWithDiditCredentials(base44, tenantRow.id);
  if (!tenant?.didit_api_key) return { tenant_id: tenantRow.id, skipped: 'no_didit_credentials' };

  const cutoff = new Date(Date.now() - MIN_AGE_MS).toISOString();
  const rows = asList(await base44.asServiceRole.entities.Transaction.filter(
    { tenant_id: tenantRow.id, didit_submission_status: { $in: ['failed', 'not_submitted'] }, created_date: { $lte: cutoff } },
    '-created_date', MAX_PER_TENANT,
  )).filter((t) => t.our_transaction_id && !t.own_transfer && !t.didit_transaction_id);

  const counts = { linked: 0, resubmitted: 0, unresolved: 0 };
  const unresolved = [];
  const clientCache = new Map();
  for (const t of rows) {
    let outcome;
    try {
      outcome = await reconcileOne(base44, tenant, t, clientCache);
    } catch (e) {
      // Search itself failed (Didit down / auth): leave the row as it is for the next run.
      outcome = 'unresolved';
      console.warn('reconcileDiditTransactions: row failed', { id: t.id, error: errText(e) });
    }
    counts[outcome] += 1;
    if (outcome === 'unresolved') unresolved.push(t.id);
  }

  if (rows.length > 0) {
    await writeAudit(base44, SYSTEM, {
      tenantId: tenantRow.id, eventType: 'tm_didit_reconcile',
      after: { checked: rows.length, ...counts, unresolved_transaction_ids: unresolved.slice(0, 50) },
      notes: `Didit reconcile: ${counts.linked} linked, ${counts.resubmitted} resubmitted, ${counts.unresolved} need Ops attention.`,
    }).catch(() => {});
  }
  return { tenant_id: tenantRow.id, checked: rows.length, ...counts };
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

    const tenants = asList(await base44.asServiceRole.entities.Tenant.list('-created_date', 1000))
      .filter((t) => t.status !== 'Suspended' && isTmEnabled(t, 'tm_core') && (!onlyTenant || t.id === onlyTenant));

    const results = [];
    for (const t of tenants) {
      try {
        results.push(await processTenant(base44, t));
      } catch (e) {
        results.push({ tenant_id: t.id, error: String(e?.message || e).slice(0, 300) });
      }
    }
    return Response.json({ tenants: results.length, results });
  } catch (error) {
    return errorResponse(error);
  }
}
