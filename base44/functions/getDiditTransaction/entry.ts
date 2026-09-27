/**
 * Fetches the latest status/decision for one transaction from Didit and
 * refreshes the local Transaction record. Used by the "Refresh" action on
 * the Transaction detail panel.
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.49';

export default async function(req) {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const tenantId = user.tenant_id;
    const tenants = await base44.asServiceRole.entities.Tenant.filter({ id: tenantId });
    const tenant = tenants?.[0];
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
    if (!record.didit_transaction_id) {
      return Response.json({ error: 'No Didit transaction ID on this record yet' }, { status: 400 });
    }

    const response = await fetch(`https://verification.didit.me/v3/transactions/${record.didit_transaction_id}/`, {
      headers: { 'x-api-key': tenant.didit_api_key },
    });

    if (!response.ok) {
      const detail = await response.text();
      return Response.json({ error: 'transaction_fetch_failed', detail }, { status: 502 });
    }

    const txn = await response.json();

    const updated = await base44.entities.Transaction.update(record.id, {
      status: txn.status || record.status,
      risk_score: txn.risk_score ?? record.risk_score,
      risk_level: txn.risk_level ?? record.risk_level,
      decision_raw: txn,
    });

    return Response.json({ transaction: txn, record: updated });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}