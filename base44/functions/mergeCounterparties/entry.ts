// mergeCounterparties — merge B into A (and unmerge) for users with tmWorkCase. No API-key access.
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.52';
import { writeAudit } from '../../shared/tmAudit.js';
import { normaliseAccount } from '../../shared/tmCounterparty.js';
import { authenticate, errorResponse, httpError, chunk, asList, WORK_ROLES } from '../../shared/tmAuth.js';

async function loadCp(E, tenantId, id) {
  const cp = asList(await E.Counterparty.filter({ tenant_id: tenantId, id }))[0];
  if (!cp) throw httpError(404, 'Counterparty not found');
  return cp;
}

async function txnIdsFor(E, tenantId, counterpartyId) {
  const ids = [];
  let skip = 0;
  for (;;) {
    const page = asList(await E.Transaction.filter({ tenant_id: tenantId, counterparty_id: counterpartyId }, undefined, 500, skip));
    ids.push(...page.map((t) => t.id));
    if (page.length < 500) break;
    skip += 500;
  }
  return ids;
}

const repoint = async (E, ids, counterpartyId) => {
  for (const g of chunk(ids, 200)) await E.Transaction.bulkUpdate(g.map((id) => ({ id, counterparty_id: counterpartyId })));
};

export default async function (req) {
  try {
    const base44 = createClientFromRequest(req);
    const body = await req.json();
    const auth = await authenticate(base44, req, body, { roles: WORK_ROLES, allowApiKey: false });
    const tenantId = auth.tenantId;
    const E = base44.asServiceRole.entities;
    const action = body.action || 'merge';
    const now = new Date().toISOString();

    if (action === 'merge') {
      const { source_id: bId, target_id: aId } = body;
      if (!bId || !aId) throw httpError(400, 'source_id (B) and target_id (A) are required');
      if (bId === aId) throw httpError(400, 'Cannot merge a counterparty into itself');
      const [A, B] = [await loadCp(E, tenantId, aId), await loadCp(E, tenantId, bId)];
      if (A.merged_into) throw httpError(409, 'Target counterparty has itself been merged');
      if (B.merged_into) throw httpError(409, 'Source counterparty is already merged');

      const aNames = new Set([A.display_name, ...(A.names || [])].map((n) => String(n).toUpperCase()));
      const addedNames = [B.display_name, ...(B.names || [])].filter((n, i, arr) => n && !aNames.has(String(n).toUpperCase()) && arr.indexOf(n) === i);
      const aIdents = new Set((A.identifiers || []).map((i) => normaliseAccount(i.value)));
      const addedIdents = (B.identifiers || []).filter((i) => !aIdents.has(normaliseAccount(i.value)));

      const txnIds = await txnIdsFor(E, tenantId, bId);
      await repoint(E, txnIds, aId);

      await E.Counterparty.update(aId, {
        names: [...(A.names || []), ...addedNames],
        identifiers: [...(A.identifiers || []), ...addedIdents],
        merge_history: [...(A.merge_history || []), { type: 'absorbed', counterparty_id: bId, at: now, by_user_id: auth.actorUserId, added_names: addedNames, added_identifiers: addedIdents, transaction_count: txnIds.length }],
      });
      await E.Counterparty.update(bId, {
        merged_into: aId,
        merge_history: [...(B.merge_history || []), { type: 'merge', into: aId, at: now, by_user_id: auth.actorUserId, transaction_ids: txnIds }],
      });

      await writeAudit(base44, auth, {
        tenantId, eventType: 'tm_counterparty_merged',
        before: { source: bId, target: aId, source_merged_into: null },
        after: { source_merged_into: aId, transactions_repointed: txnIds.length, names_added: addedNames.length, identifiers_added: addedIdents.length },
        notes: `Merged counterparty "${B.display_name}" into "${A.display_name}" (${txnIds.length} transaction(s) repointed).`,
      });
      return Response.json({ merged: true, target_id: aId, source_id: bId, transactions_repointed: txnIds.length });
    }

    if (action === 'unmerge') {
      const { source_id: bId } = body;
      if (!bId) throw httpError(400, 'source_id (B) is required');
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
        merge_history: [...(A.merge_history || []), { type: 'released', counterparty_id: bId, at: now, by_user_id: auth.actorUserId }],
      });
      await E.Counterparty.update(bId, {
        merged_into: '',
        merge_history: [...history, { type: 'unmerge', from: A.id, at: now, by_user_id: auth.actorUserId, transaction_ids: moved }],
      });

      await writeAudit(base44, auth, {
        tenantId, eventType: 'tm_counterparty_unmerged',
        before: { source: bId, source_merged_into: A.id },
        after: { source_merged_into: null, transactions_restored: moved.length },
        notes: `Unmerged counterparty "${B.display_name}" from "${A.display_name}" (${moved.length} transaction(s) restored).`,
      });
      return Response.json({ unmerged: true, source_id: bId, transactions_restored: moved.length });
    }

    throw httpError(400, 'action must be merge or unmerge');
  } catch (error) {
    return errorResponse(error);
  }
}