// listCounterparties — tenant-scoped counterparty list with transaction stats (tmViewAlerts roles).
// filters: { client_id?, q?, country?, screening_status?, has_low_confidence?, id?, limit? }
// Stats come from one server-side aggregate over Transaction: count, total reporting-currency amount, linked clients,
// last seen and the lowest match confidence. Merged-away counterparties are hidden unless asked for by id.
// With `id` the response also carries the merge history context and linked clients (drawer detail).
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.52';
import { isTmEnabled } from '../../shared/tmGuards.js';
import { authenticate, errorResponse, httpError, loadTenant, asList, chunk } from '../../shared/tmAuth.js';

const VIEW_ROLES = ['Analyst', 'QC Reviewer', 'Compliance Officer', 'Manager', 'Director', 'Compliance Admin', 'Tenant Admin']; // tmViewAlerts
const LOW_CONFIDENCE = 0.95;
const MAX_GROUPS = 1000;
const esc = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

const statsOf = (r) => ({
  transaction_count: r?.count || 0,
  total_amount: round2(r?.sum_fx_amount_reporting),
  linked_clients: r?.count_distinct_client_id || 0,
  last_seen: r?.max_executed_at || null,
  lowest_confidence: r?.min_counterparty_match_confidence ?? null,
});

export default async function (req) {
  try {
    const base44 = createClientFromRequest(req);
    const body = await req.json().catch(() => ({}));
    const auth = await authenticate(base44, req, body, { roles: VIEW_ROLES, allowApiKey: false });
    const tid = auth.tenantId;
    const tenant = await loadTenant(base44, tid);
    if (!isTmEnabled(tenant, 'tm_core')) throw httpError(403, 'Feature tm_core is not enabled');
    const E = base44.asServiceRole.entities;
    const f = body.filters || body || {};
    const limit = Math.min(Math.max(Number(f.limit) || 50, 1), 200);

    // Transaction stats, grouped by counterparty (scoped to a client when asked).
    const txnQuery = { tenant_id: tid, counterparty_id: { $exists: true }, ...(f.client_id ? { client_id: f.client_id } : {}), ...(f.id ? { counterparty_id: f.id } : {}) };
    const agg = await E.Transaction.aggregate({
      query: txnQuery, groupBy: 'counterparty_id', sum: ['fx.amount_reporting'], min: ['counterparty_match_confidence'], max: ['executed_at'],
      countDistinct: 'client_id', sort: '-sum_fx_amount_reporting', limit: MAX_GROUPS,
    });
    let rows = (agg?.rows || []).filter((r) => r.counterparty_id);
    if (f.has_low_confidence) rows = rows.filter((r) => r.min_counterparty_match_confidence != null && r.min_counterparty_match_confidence < LOW_CONFIDENCE);
    const statById = new Map(rows.map((r) => [r.counterparty_id, r]));

    // Counterparty records, with the text/country/screening filters applied on the server.
    const cpFilter = {};
    if (f.country) cpFilter.country = String(f.country).toUpperCase();
    if (f.screening_status) cpFilter.screening_status = f.screening_status;
    if (f.q && String(f.q).trim()) {
      const rx = { $regex: esc(String(f.q).trim()), $options: 'i' };
      cpFilter.$or = [{ display_name: rx }, { names: rx }, { 'identifiers.value': rx }];
    }
    const found = [];
    if (f.id) {
      const cp = asList(await E.Counterparty.filter({ tenant_id: tid, id: f.id }))[0];
      if (!cp) throw httpError(404, 'Counterparty not found');
      found.push(cp);
    } else {
      for (const g of chunk(rows.map((r) => r.counterparty_id), 200)) {
        found.push(...asList(await E.Counterparty.filter({ tenant_id: tid, id: { $in: g }, ...cpFilter }, undefined, 200)));
      }
    }
    const byId = new Map(found.map((c) => [c.id, c]));
    const counterparties = (f.id ? found : rows.map((r) => byId.get(r.counterparty_id)).filter((c) => c && !c.merged_into))
      .slice(0, limit)
      .map((c) => ({ ...c, ...statsOf(statById.get(c.id)) }));

    if (!f.id) return Response.json({ counterparties, truncated: (agg?.rows || []).length >= MAX_GROUPS });

    // Detail: names of every counterparty named in the merge history, and the clients that transact with this one.
    const cp = counterparties[0];
    const refIds = [...new Set((cp.merge_history || []).flatMap((h) => [h.counterparty_id, h.into, h.from]).filter(Boolean))];
    const related = {};
    for (const g of chunk(refIds, 100)) {
      for (const r of asList(await E.Counterparty.filter({ tenant_id: tid, id: { $in: g } }, undefined, 100))) related[r.id] = { display_name: r.display_name, merged_into: r.merged_into || null };
    }
    const byClient = await E.Transaction.aggregate({ query: { tenant_id: tid, counterparty_id: cp.id }, groupBy: 'client_id', limit: 200 });
    const clientIds = (byClient?.rows || []).map((r) => r.client_id).filter(Boolean);
    const linked_clients = clientIds.length
      ? asList(await E.Client.filter({ tenant_id: tid, id: { $in: clientIds } }, undefined, 200)).map((c) => ({ id: c.id, full_name: c.full_name }))
      : [];
    return Response.json({ counterparty: cp, related, linked_clients });
  } catch (error) {
    console.error('listCounterparties error:', error?.message);
    return errorResponse(error);
  }
}