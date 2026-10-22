/**
 * Creates + screens a transaction via Didit's transaction monitoring API (AML/KYT).
 * The Transaction row is created first with a stable our_transaction_id (Didit's idempotency key), then submitted.
 * An uncertain failure leaves the row as didit_submission_status 'failed' with the same id; the nightly
 * reconcileDiditTransactions job looks it up at Didit before resending, so no duplicate is created.
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.49';
import { withDiditCredentials } from '../../shared/diditCredentials.js';
import { postTransaction, buildTransactionBody, diditTxnUuid, normaliseTxnStatus } from '../../shared/diditTm.js';
import { isTmEnabled } from '../../shared/tmGuards.js';
import { afterTransactionUpdate } from '../../shared/diditTxnActions.js';

const CATEGORIES = ['finance', 'kyc', 'travel_rule', 'user_event', 'audit_trail_event', 'gambling_bet', 'gambling_limit_change', 'gambling_bonus_change'];

export default async function(req) {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const tenantId = user.tenant_id;
    if (!tenantId) return Response.json({ error: 'No tenant associated with this user' }, { status: 400 });

    const tenants = await base44.asServiceRole.entities.Tenant.filter({ id: tenantId });
    const tenant = await withDiditCredentials(base44, tenants?.[0]);
    if (!tenant?.didit_api_key) {
      return Response.json({ error: 'Didit is not configured for this institution. Contact your Tenant Admin.' }, { status: 400 });
    }

    const body = await req.json();
    const {
      client_id, case_id, transaction_category, direction, amount, currency, currency_kind,
      counterparty_name, counterparty_account_id, counterparty_method_type, counterparty_country,
      subject_entity_type, subject_full_name,
    } = body;

    if (!client_id || !transaction_category || !direction || amount == null || !currency || !currency_kind) {
      return Response.json({ error: 'Missing required transaction fields' }, { status: 400 });
    }
    if (!CATEGORIES.includes(transaction_category)) return Response.json({ error: 'Invalid transaction_category' }, { status: 400 });

    const clients = await base44.asServiceRole.entities.Client.filter({ tenant_id: tenantId, id: client_id });
    const client = clients?.[0];
    if (!client || client.tenant_id !== tenantId) return Response.json({ error: 'Client not found' }, { status: 404 });

    const entityType = subject_entity_type === 'company' || (!subject_entity_type && client.client_type === 'ORG') ? 'company' : 'person';
    const ourTransactionId = `vt_m_${crypto.randomUUID().replace(/-/g, '')}`;
    const nowIso = new Date().toISOString();

    // 1. Row first, so the id is never lost if Didit accepts but the response does not arrive.
    const record = await base44.asServiceRole.entities.Transaction.create({
      tenant_id: tenantId, client_id, case_id: case_id || null, our_transaction_id: ourTransactionId,
      transaction_category, direction, amount, currency, currency_kind,
      counterparty_name, counterparty_account_id, counterparty_method_type, counterparty_country: counterparty_country || undefined,
      subject_entity_type: entityType, subject_full_name: subject_full_name || client.full_name,
      status: 'PENDING', executed_at: nowIso, source_type: 'manual', didit_submission_status: 'not_submitted',
      submitted_by_user_id: user.id,
    });

    // 2. Submit (retries 429/5xx with backoff, 15s timeout).
    const diditBody = buildTransactionBody(record, client, ourTransactionId, tenantId, null);
    if (case_id) diditBody.metadata.case_id = case_id;
    let txn;
    try {
      txn = await postTransaction(tenant, diditBody);
    } catch (e) {
      const detail = typeof e?.detail === 'string' ? e.detail : JSON.stringify(e?.detail ?? e?.message ?? e);
      await base44.asServiceRole.entities.Transaction.update(record.id, {
        didit_submission_status: 'failed', didit_submission_error: `${e?.status ? `HTTP ${e.status}: ` : ''}${detail}`.slice(0, 500),
      });
      return Response.json({ error: 'transaction_create_failed', detail: 'Didit did not confirm the submission. It will be reconciled automatically.', record_id: record.id }, { status: 502 });
    }

    const status = normaliseTxnStatus(txn?.status);
    const updated = await base44.asServiceRole.entities.Transaction.update(record.id, {
      didit_transaction_id: diditTxnUuid(txn) || undefined, status,
      risk_score: txn?.score ?? txn?.risk_score ?? null, risk_level: txn?.severity ?? txn?.risk_level ?? null,
      decision_raw: txn, didit_submission_status: 'submitted', didit_submission_error: '',
    });
    if (txn?.action_required && isTmEnabled(tenant, 'tm_core')) {
      await afterTransactionUpdate(base44, tenant, { ...record, didit_transaction_id: diditTxnUuid(txn) }, 'PENDING', status, txn)
        .catch((e) => console.warn('createDiditTransaction: action_required follow-up failed', e?.message));
    }

    return Response.json({ transaction: txn, record: updated || { ...record, status } });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}
