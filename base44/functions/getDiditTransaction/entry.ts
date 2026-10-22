/**
 * Fetches the latest status/decision for one transaction from Didit and
 * refreshes the local Transaction record. Used by the "Refresh" action on
 * the Transaction detail panel. When the Didit uuid is missing (older rows),
 * the transaction is looked up by our transaction id first.
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.49';
import { withDiditCredentials } from '../../shared/diditCredentials.js';
import { getTransaction, findTransactionByTxnId, diditTxnUuid, normaliseTxnStatus } from '../../shared/diditTm.js';
import { isTmEnabled } from '../../shared/tmGuards.js';
import { afterTransactionUpdate } from '../../shared/diditTxnActions.js';

export default async function(req) {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const tenantId = user.tenant_id;
    const tenants = await base44.asServiceRole.entities.Tenant.filter({ id: tenantId });
    const tenant = await withDiditCredentials(base44, tenants?.[0]);
    if (!tenant?.didit_api_key) {
      return Response.json({ error: 'Didit is not configured for this institution.' }, { status: 400 });
    }

    const { transaction_id } = await req.json();
    if (!transaction_id) return Response.json({ error: 'transaction_id is required' }, { status: 400 });

    const records = await base44.entities.Transaction.filter({ id: transaction_id });
    const record = records?.[0];
    if (!record || record.tenant_id !== tenantId) {
      return Response.json({ error: 'Transaction not found' }, { status: 404 });
    }

    let txn;
    try {
      if (record.didit_transaction_id) txn = await getTransaction(tenant, record.didit_transaction_id);
      else if (record.our_transaction_id) txn = await findTransactionByTxnId(tenant, record.our_transaction_id);
    } catch (e) {
      return Response.json({ error: 'transaction_fetch_failed', detail: typeof e?.detail === 'string' ? e.detail : `HTTP ${e?.status || 'error'}` }, { status: 502 });
    }
    if (!txn) return Response.json({ error: 'This transaction was not found at Didit yet' }, { status: 404 });

    const status = normaliseTxnStatus(txn.status, record.status || 'PENDING');
    const updated = await base44.entities.Transaction.update(record.id, {
      status,
      ...(diditTxnUuid(txn) && !record.didit_transaction_id ? { didit_transaction_id: diditTxnUuid(txn), didit_submission_status: 'submitted', didit_submission_error: '' } : {}),
      risk_score: txn.score ?? txn.risk_score ?? record.risk_score,
      risk_level: txn.severity ?? txn.risk_level ?? record.risk_level,
      decision_raw: txn,
    });
    if (isTmEnabled(tenant, 'tm_core') && (status !== record.status || txn.action_required)) {
      await afterTransactionUpdate(base44, tenant, record, record.status, status, txn).catch((e) => console.warn('getDiditTransaction follow-up failed', e?.message));
    }

    return Response.json({ transaction: txn, record: updated });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}
