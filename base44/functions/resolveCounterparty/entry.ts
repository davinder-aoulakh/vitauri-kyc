// resolveCounterparty — match/create counterparties for transactions (identifier first, then Jaro-Winkler >= 0.90 + same country).
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.52';
import { resolveAndStore } from '../../shared/tmResolve.js';
import { writeAudit } from '../../shared/tmAudit.js';
import { authenticate, errorResponse, httpError, chunk, asList, INGEST_ROLES, WORK_ROLES } from '../../shared/tmAuth.js';

const MAX_IDS = 50;

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

    const txns = asList(await E.Transaction.filter({ tenant_id: tenantId, id: { $in: ids } }, undefined, MAX_IDS));
    const eligible = txns.filter((t) => !t.own_transfer);
    const { updates, stats } = await resolveAndStore(base44, auth, tenantId, eligible, body.batch_id);
    for (const g of chunk(updates, 100)) await E.Transaction.bulkUpdate(g);

    const clientIds = [...new Set(txns.map((t) => t.client_id))];
    await writeAudit(base44, auth, {
      tenantId, clientId: clientIds.length === 1 ? clientIds[0] : undefined, eventType: 'tm_counterparties_resolved',
      before: { transactions: txns.length },
      after: { linked: updates.length, ...stats },
      notes: `Resolved counterparties for ${eligible.length} transaction(s): ${stats.created} created, ${stats.matched_identifier + stats.matched_name} matched.`,
    });

    return Response.json({ requested: ids.length, found: txns.length, linked: updates.length, stats });
  } catch (error) {
    return errorResponse(error);
  }
}