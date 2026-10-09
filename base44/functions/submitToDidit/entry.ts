// submitToDidit — push canonical transactions to Didit TM (same body shape as createDiditTransaction, plus timestamp + profile).
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.52';
import { postTransaction } from '../../shared/diditTm.js';
import { sha256Hex } from '../../shared/tmCanonical.js';
import { isTmEnabled } from '../../shared/tmGuards.js';
import { writeAudit } from '../../shared/tmAudit.js';
import {
  authenticate, errorResponse, httpError, loadTenant, chunk, asList, mapLimit, INGEST_ROLES, WORK_ROLES,
} from '../../shared/tmAuth.js';

const MAX_IDS = 50;
const STATUSES = ['PENDING', 'APPROVED', 'IN_REVIEW', 'DECLINED', 'AWAITING_USER'];

export default async function (req) {
  try {
    const base44 = createClientFromRequest(req);
    const body = await req.json();
    const auth = await authenticate(base44, req, body, { roles: [...INGEST_ROLES, ...WORK_ROLES], scope: 'ingest:write' });
    const tenantId = auth.tenantId;
    const E = base44.asServiceRole.entities;

    const ids = [...new Set(body.transaction_ids || [])];
    if (!ids.length) throw httpError(400, 'transaction_ids is required');
    if (ids.length > MAX_IDS) throw httpError(413, `Max ${MAX_IDS} transaction_ids per call`);

    const tenant = await loadTenant(base44, tenantId);
    const txns = asList(await E.Transaction.filter({ tenant_id: tenantId, id: { $in: ids } }, undefined, MAX_IDS));
    const clientIds = [...new Set(txns.map((t) => t.client_id))];
    const auditClient = clientIds.length === 1 ? clientIds[0] : undefined;

    const skipReason = !tenant.didit_api_key ? 'didit_not_configured' : !isTmEnabled(tenant, 'tm_core') ? 'tm_core_disabled' : null;
    if (skipReason) {
      await writeAudit(base44, auth, {
        tenantId, clientId: auditClient, eventType: 'tm_didit_submission_skipped',
        before: { transactions: txns.length }, after: { reason: skipReason }, notes: `Submission skipped: ${skipReason}.`,
      });
      return Response.json({ submitted: 0, failed: 0, skipped: true, reason: skipReason });
    }

    const todo = txns.filter((t) => !t.own_transfer && t.didit_submission_status !== 'submitted');
    const alreadyDone = txns.filter((t) => t.didit_submission_status === 'submitted').length;
    const ownSkipped = txns.filter((t) => t.own_transfer).length;

    // Clients + latest approved ExpectedProfile per client (tenant-scoped)
    const clients = new Map();
    const profiles = new Map();
    for (const c of chunk(clientIds, 100)) {
      for (const cl of asList(await E.Client.filter({ tenant_id: tenantId, id: { $in: c } }))) clients.set(cl.id, cl);
      for (const p of asList(await E.ExpectedProfile.filter({ tenant_id: tenantId, client_id: { $in: c }, status: 'approved' }, '-version', 200))) {
        const cur = profiles.get(p.client_id);
        if (!cur || (p.version || 0) > (cur.version || 0)) profiles.set(p.client_id, p);
      }
    }

    const results = await mapLimit(todo, 6, async (t) => {
      const client = clients.get(t.client_id);
      let ourId = t.our_transaction_id;
      if (!ourId) {
        const ymd = String(t.executed_at || new Date().toISOString()).slice(0, 10).replace(/-/g, '');
        const short = (await sha256Hex(`${t.id}|${t.dedupe_key || ''}`)).slice(0, 10);
        ourId = `vt_${t.client_id}_${ymd}_${short}`.slice(0, 128);
      }
      const diditBody = {
        transaction_id: ourId,
        transaction_category: 'finance',
        timestamp: t.executed_at,
        transaction_details: { direction: t.direction, amount: t.amount, currency: t.currency, currency_kind: t.currency_kind || 'fiat' },
        subject: {
          entity_type: t.subject_entity_type || (client?.client_type === 'ORG' ? 'company' : 'person'),
          vendor_data: t.client_id,
          full_name: t.subject_full_name || client?.full_name,
        },
        counterparty: {
          full_name: t.counterparty_name,
          payment_method: { method_type: 'bank_account', account_id: t.counterparty_account_id },
        },
        metadata: { tenant_id: tenantId, client_id: t.client_id, our_transaction_id: ourId },
      };
      const prof = profiles.get(t.client_id);
      if (prof) {
        diditBody.custom_properties = {
          profile_version: prof.version,
          inbound_max_month: prof.inbound_max_month,
          outbound_foreign_max_month: prof.outbound_foreign_max_month,
          allowed_countries: prof.allowed_countries,
          cash_max_month: prof.cash_max_month,
        };
      }
      try {
        const res = await postTransaction(tenant, diditBody);
        const st = String(res?.status || 'PENDING').toUpperCase().replace(/[\s-]+/g, '_');
        return {
          id: t.id, our_transaction_id: ourId,
          didit_transaction_id: res?.transaction_id || res?.id,
          status: STATUSES.includes(st) ? st : 'PENDING',
          risk_score: res?.risk_score ?? undefined,
          risk_level: res?.risk_level ?? undefined,
          decision_raw: res,
          didit_submission_status: 'submitted',
          didit_submission_error: '',
        };
      } catch (e) {
        const detail = typeof e?.detail === 'string' ? e.detail : JSON.stringify(e?.detail ?? e?.message ?? e);
        return {
          id: t.id, our_transaction_id: ourId, didit_submission_status: 'failed',
          didit_submission_error: `${e?.status ? `HTTP ${e.status}: ` : ''}${detail}`.slice(0, 500),
        };
      }
    });

    const rows = results.map((r) => r.value).filter(Boolean).map((r) => {
      for (const k of Object.keys(r)) if (r[k] === undefined) delete r[k];
      return r;
    });
    for (const g of chunk(rows, 100)) await E.Transaction.bulkUpdate(g);
    const submitted = rows.filter((r) => r.didit_submission_status === 'submitted').length;
    const failed = rows.length - submitted + results.filter((r) => !r.ok).length;

    await writeAudit(base44, auth, {
      tenantId, clientId: auditClient, eventType: 'tm_didit_submission',
      before: { transactions: txns.length },
      after: { submitted, failed, already_submitted: alreadyDone, own_transfers_skipped: ownSkipped, with_profile: todo.filter((t) => profiles.has(t.client_id)).length },
      notes: `Submitted ${submitted} of ${todo.length} transaction(s) to Didit; ${failed} failed.`,
    });

    return Response.json({ submitted, failed, already_submitted: alreadyDone, own_transfers_skipped: ownSkipped, skipped: false });
  } catch (error) {
    return errorResponse(error);
  }
}