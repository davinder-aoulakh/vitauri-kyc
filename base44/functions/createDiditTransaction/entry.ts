/**
 * Creates + screens a transaction via Didit's transaction monitoring API (AML/KYT).
 * Uses the tenant's existing didit_api_key (same key used by createDiditSession).
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.49';

export default async function(req) {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const tenantId = user.tenant_id;
    if (!tenantId) return Response.json({ error: 'No tenant associated with this user' }, { status: 400 });

    const tenants = await base44.asServiceRole.entities.Tenant.filter({ id: tenantId });
    const tenant = tenants?.[0];
    if (!tenant?.didit_api_key) {
      return Response.json({ error: 'Didit is not configured for this institution. Contact your Tenant Admin.' }, { status: 400 });
    }

    const body = await req.json();
    const {
      client_id, case_id, transaction_category, direction, amount, currency, currency_kind,
      counterparty_name, counterparty_account_id, counterparty_method_type,
      subject_entity_type, subject_full_name,
    } = body;

    if (!client_id || !transaction_category || !direction || amount == null || !currency || !currency_kind) {
      return Response.json({ error: 'Missing required transaction fields' }, { status: 400 });
    }

    const clients = await base44.asServiceRole.entities.Client.filter({ id: client_id });
    const client = clients?.[0];
    if (!client) return Response.json({ error: 'Client not found' }, { status: 404 });

    const ourTransactionId = `${tenantId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`.slice(0, 128);

    const diditBody = {
      transaction_id: ourTransactionId,
      transaction_category,
      transaction_details: { direction, amount, currency, currency_kind },
      subject: {
        entity_type: subject_entity_type || 'person',
        vendor_data: client_id,
        full_name: subject_full_name || client.full_name,
      },
      counterparty: {
        full_name: counterparty_name,
        payment_method: {
          method_type: counterparty_method_type,
          account_id: counterparty_account_id,
        },
      },
      metadata: {
        tenant_id: tenantId,
        client_id,
        case_id: case_id || null,
        our_transaction_id: ourTransactionId,
      },
    };

    const response = await fetch('https://verification.didit.me/v3/transactions/', {
      method: 'POST',
      headers: { 'x-api-key': tenant.didit_api_key, 'Content-Type': 'application/json' },
      body: JSON.stringify(diditBody),
    });

    if (!response.ok) {
      const detail = await response.text();
      return Response.json({ error: 'transaction_create_failed', detail }, { status: 502 });
    }

    const txn = await response.json();

    const record = await base44.entities.Transaction.create({
      tenant_id: tenantId,
      client_id,
      case_id: case_id || null,
      our_transaction_id: ourTransactionId,
      didit_transaction_id: txn.transaction_id || txn.id,
      transaction_category,
      direction,
      amount,
      currency,
      currency_kind,
      counterparty_name,
      counterparty_account_id,
      counterparty_method_type,
      subject_entity_type: subject_entity_type || 'person',
      subject_full_name: subject_full_name || client.full_name,
      status: txn.status || 'PENDING',
      risk_score: txn.risk_score ?? null,
      risk_level: txn.risk_level ?? null,
      decision_raw: txn,
      submitted_by_user_id: user.id,
    });

    return Response.json({ transaction: txn, record });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}