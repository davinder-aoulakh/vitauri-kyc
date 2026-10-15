// mergeCounterparties — merge B into A (and unmerge) for users with tmWorkCase. No API-key access.
//   merge   { target_id, source_ids[] (or legacy source_id), reason }
//   unmerge { counterparty_id (or legacy source_id), reason? }
// Every action writes AuditEvents and recomputes customer risk for the clients whose transactions moved.
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.52';
import { writeAudit } from '../../shared/tmAudit.js';
import { normaliseAccount } from '../../shared/tmCounterparty.js';
import { recomputeCustomerRisk } from '../../shared/tmRisk.js';
import { authenticate, errorResponse, httpError, chunk, asList, loadTenant, WORK_ROLES } from '../../shared/tmAuth.js';

async function loadCp(E, tenantId, id) {
  const cp = asList(await E.Counterparty.filter({ tenant_id: tenantId, id }))[0];
  if (!cp) throw httpError(404, 'Counterparty not found');
  return cp;
}

/** { ids, clients } of the transactions pointing at a counterparty. */
async function txnsFor(E, tenantId, counterpartyId) {
  const ids = [];
  const clients = new Set();
  let skip = 0;
  for (;;) {
    const page = asList(await E.Transaction.filter({ tenant_id: tenantId, counterparty_id: counterpartyId }, undefined, 500, skip));
    for (const t of page) { ids.push(t.id); if (t.client_id) clients.add(t.client_id); }
    if (page.length < 500) break;
    skip += 500;
  }
  return { ids, clients };
}

const repoint = async (E, ids, counterpartyId) => {
  for (const g of chunk(ids, 200)) await E.Transaction.bulkUpdate(g.map((id) => ({ id, counterparty_id: counterpartyId })));
};

async function clientsOf(E, tenantId, ids) {
  const out = new Set();
  for (const g of chunk(ids, 100)) {
    for (const t of asList(await E.Transaction.filter({ tenant_id: tenantId, id: { $in: g } }, undefined, 100))) if (t.client_id) out.add(t.client_id);
  }
  return out;
}

/** Recompute risk per affected client. A failure never undoes the merge; it is reported. */
async function recompute(base44, auth, tenantId, clientIds, trigger) {
  const done = [];
  const failed = [];
  if (!clientIds.size) return { done, failed };
  const tenant = await loadTenant(base44, tenantId);
  for (const clientId of clientIds) {
    try { await recomputeCustomerRisk(base44, { tenantId, tenant, clientId, trigger, actor: auth }); done.push(clientId); } catch (e) { failed.push(clientId); }
  }
  return { done, failed };
}

export default async function (req) {
  try {
    const base44 = createClientFromRequest(req);
    const body = await req.json();
    const auth = await authenticate(base44, req, body, { roles: WORK_ROLES, allowApiKey: false });
    const tenantId = auth.tenantId;
    const E = base44.asServiceRole.entities;
    const action = body.action || 'merge';
    const now = new Date().toISOString();
    const reason = typeof body.reason === 'string' ? body.reason.trim().slice(0, 500) : '';

    if (action === 'merge') {
      const aId = body.target_id;
      const sourceIds = [...new Set(Array.isArray(body.source_ids) ? body.source_ids : (body.source_id ? [body.source_id] : []))];
      if (!aId || !sourceIds.length) throw httpError(400, 'target_id and source_ids are required');
      if (sourceIds.includes(aId)) throw httpError(400, 'Cannot merge a counterparty into itself');
      if (!reason) throw httpError(400, 'A reason is required');
      const A0 = await loadCp(E, tenantId, aId);
      if (A0.merged_into) throw httpError(409, 'Target counterparty has itself been merged');
      const sources = [];
      for (const id of sourceIds) {
        const B = await loadCp(E, tenantId, id);
        if (B.merged_into) throw httpError(409, `"${B.display_name}" is already merged`);
        sources.push(B);
      }

      const affected = new Set();
      let totalMoved = 0;
      for (const B of sources) {
        const A = await loadCp(E, tenantId, aId); // re-read: each merge extends A
        const aNames = new Set([A.display_name, ...(A.names || [])].map((n) => String(n).toUpperCase()));
        const addedNames = [B.display_name, ...(B.names || [])].filter((n, i, arr) => n && !aNames.has(String(n).toUpperCase()) && arr.indexOf(n) === i);
        const aIdents = new Set((A.identifiers || []).map((i) => normaliseAccount(i.value)));
        const addedIdents = (B.identifiers || []).filter((i) => !aIdents.has(normaliseAccount(i.value)));

        const { ids: txnIds, clients } = await txnsFor(E, tenantId, B.id);
        await repoint(E, txnIds, aId);
        clients.forEach((c) => affected.add(c));
        totalMoved += txnIds.length;

        await E.Counterparty.update(aId, {
          names: [...(A.names || []), ...addedNames],
          identifiers: [...(A.identifiers || []), ...addedIdents],
          merge_history: [...(A.merge_history || []), { type: 'absorbed', counterparty_id: B.id, at: now, by_user_id: auth.actorUserId, reason, added_names: addedNames, added_identifiers: addedIdents, transaction_count: txnIds.length }],
        });
        await E.Counterparty.update(B.id, {
          merged_into: aId,
          merge_history: [...(B.merge_history || []), { type: 'merge', into: aId, at: now, by_user_id: auth.actorUserId, reason, transaction_ids: txnIds }],
        });

        await writeAudit(base44, auth, {
          tenantId, eventType: 'tm_counterparty_merged',
          before: { source: B.id, target: aId, source_merged_into: null },
          after: { source_merged_into: aId, transactions_repointed: txnIds.length, names_added: addedNames.length, identifiers_added: addedIdents.length, reason },
          notes: `Merged counterparty "${B.display_name}" into "${A.display_name}" (${txnIds.length} transaction(s) repointed). Reason: ${reason}`,
        });
      }

      const risk = await recompute(base44, auth, tenantId, affected, 'counterparty_merge');
      return Response.json({ merged: true, target_id: aId, source_ids: sourceIds, transactions_repointed: totalMoved, risk_recomputed: risk.done.length, risk_failed: risk.failed.length });
    }

    if (action === 'unmerge') {
      const bId = body.counterparty_id || body.source_id;
      if (!bId) throw httpError(400, 'counterparty_id is required');
      const B = await loadCp(E, tenantId, bId);
      if (!B.merged_into) throw httpError(409, 'Counterparty is not merged');
      const history = B.merge_history || [];
      const entry = [...history].reverse().find((h) => h.type === 'merge' && h.into === B.merged_into);
      if (!entry) throw httpError(409, 'No merge history to restore from');
      const A = await loadCp(E, tenantId, B.merged_into);

      // Only repoint transactions that still point at A
      const moved = [];
      for (const g of chunk(entry.transaction_ids || [], 100)) {
        for (const t of asList(await E.Transaction.filter({ tenant_id: tenantId, id: { $in: g }, counterparty_id: A.id }, undefined, 100))) moved.push(t.id);
      }
      await repoint(E, moved, bId);

      const absorbed = [...(A.merge_history || [])].reverse().find((h) => h.type === 'absorbed' && h.counterparty_id === bId);
      const dropNames = new Set((absorbed?.added_names || []).map((n) => String(n).toUpperCase()));
      const dropIdents = new Set((absorbed?.added_identifiers || []).map((i) => normaliseAccount(i.value)));
      await E.Counterparty.update(A.id, {
        names: (A.names || []).filter((n) => !dropNames.has(String(n).toUpperCase())),
        identifiers: (A.identifiers || []).filter((i) => !dropIdents.has(normaliseAccount(i.value))),
        merge_history: [...(A.merge_history || []), { type: 'released', counterparty_id: bId, at: now, by_user_id: auth.actorUserId, reason }],
      });
      await E.Counterparty.update(bId, {
        merged_into: '',
        merge_history: [...history, { type: 'unmerged', from: A.id, at: now, by_user_id: auth.actorUserId, reason, transaction_ids: moved }],
      });

      await writeAudit(base44, auth, {
        tenantId, eventType: 'tm_counterparty_unmerged',
        before: { source: bId, source_merged_into: A.id },
        after: { source_merged_into: null, transactions_restored: moved.length, reason },
        notes: `Unmerged counterparty "${B.display_name}" from "${A.display_name}" (${moved.length} transaction(s) restored).${reason ? ` Reason: ${reason}` : ''}`,
      });
      const risk = await recompute(base44, auth, tenantId, await clientsOf(E, tenantId, moved), 'counterparty_unmerge');
      return Response.json({ unmerged: true, counterparty_id: bId, source_id: bId, transactions_restored: moved.length, risk_recomputed: risk.done.length, risk_failed: risk.failed.length });
    }

    throw httpError(400, 'action must be merge or unmerge');
  } catch (error) {
    return errorResponse(error);
  }
}