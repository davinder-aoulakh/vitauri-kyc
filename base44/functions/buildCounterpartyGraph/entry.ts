// buildCounterpartyGraph — nightly groundwork for network detection (money flows, circular / fan-in / fan-out).
// Aggregates the last 90 days of countable transactions into one CounterpartyEdge per customer, counterparty
// and direction, and marks customer -> customer flows where the counterparty is linked to another customer.
// It only builds data: nothing here raises alerts. The detection engine is decided after the Didit validation test.
// Auth: scheduled (no user) -> all TM tenants; signed-in Compliance Admin / Tenant Admin -> own tenant only.
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.52';
import { isTmEnabled } from '../../shared/tmGuards.js';
import { writeAudit } from '../../shared/tmAudit.js';
import { countableTxns, amountInReporting } from '../../shared/tmActuals.js';
import { fetchAll } from '../../shared/tmCoverage.js';
import { asList, errorResponse, httpError } from '../../shared/tmAuth.js';

const ADMIN_ROLES = ['Compliance Admin', 'Tenant Admin'];
const WINDOW_DAYS = 90;
const DAY_MS = 86400000;

export default async function (req) {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me().catch(() => null);
    let onlyTenant = null;
    if (user && user.role !== 'admin') {
      const role = user.app_role || user.data?.app_role;
      if (!ADMIN_ROLES.includes(role)) throw httpError(403, 'Forbidden');
      onlyTenant = user.tenant_id || user.data?.tenant_id;
      if (!onlyTenant) throw httpError(403, 'No tenant associated with this user');
    }
    const E = base44.asServiceRole.entities;
    const now = new Date();
    const builtAt = now.toISOString();
    const windowTo = builtAt.slice(0, 10);
    const since = new Date(now.getTime() - WINDOW_DAYS * DAY_MS).toISOString();
    const tenants = asList(await E.Tenant.list('-created_date', 1000))
      .filter((t) => t.status === 'Active' && isTmEnabled(t, 'tm_core') && (!onlyTenant || t.id === onlyTenant));
    const results = [];

    for (const tenant of tenants) {
      const cur = tenant.tm_reporting_currency || 'USD';
      const txns = await fetchAll((cursor) => E.Transaction.filter(
        { tenant_id: tenant.id, executed_at: { $gte: since }, counterparty_id: { $exists: true } }, { limit: 1000, cursor }), 50);
      const edges = new Map();
      for (const t of countableTxns(txns)) {
        if (!t.client_id || !t.counterparty_id) continue;
        const direction = t.direction === 'inbound' ? 'in' : 'out';
        const key = `${t.client_id}|${t.counterparty_id}|${direction}`;
        const e = edges.get(key) || { client_id: t.client_id, counterparty_id: t.counterparty_id, direction, txn_count: 0, amount_reporting: 0, first_at: t.executed_at, last_at: t.executed_at };
        e.txn_count += 1;
        e.amount_reporting += amountInReporting(t, cur) ?? 0;
        if (t.executed_at < e.first_at) e.first_at = t.executed_at;
        if (t.executed_at > e.last_at) e.last_at = t.executed_at;
        edges.set(key, e);
      }

      // Counterparties that are themselves customers (linked via linkCounterparty) turn an edge into customer -> customer.
      const cpIds = [...new Set([...edges.values()].map((e) => e.counterparty_id))];
      const cpClient = new Map();
      for (let i = 0; i < cpIds.length; i += 200) {
        const rows = asList(await E.Counterparty.filter({ tenant_id: tenant.id, id: { $in: cpIds.slice(i, i + 200) } }, undefined, 200));
        rows.forEach((c) => c.client_id && cpClient.set(c.id, c.client_id));
      }

      const existing = await fetchAll((cursor) => E.CounterpartyEdge.filter({ tenant_id: tenant.id }, { limit: 1000, cursor }), 50);
      const byKey = new Map(existing.map((e) => [e.edge_key, e]));
      let created = 0, updated = 0, removed = 0;
      for (const [key, e] of edges) {
        const rec = {
          ...e, amount_reporting: Math.round(e.amount_reporting * 100) / 100,
          counterparty_client_id: cpClient.get(e.counterparty_id) || null,
          window_days: WINDOW_DAYS, window_from: since.slice(0, 10), window_to: windowTo, built_at: builtAt,
        };
        const prev = byKey.get(key);
        if (prev) { await E.CounterpartyEdge.update(prev.id, rec); updated++; } else { await E.CounterpartyEdge.create({ tenant_id: tenant.id, edge_key: key, ...rec }); created++; }
      }
      // Edges with no flow left in the window are derived data, so they are removed.
      for (const e of existing) {
        if (!edges.has(e.edge_key)) { await E.CounterpartyEdge.delete(e.id); removed++; }
      }
      const c2c = [...edges.values()].filter((e) => cpClient.get(e.counterparty_id)).length;
      await writeAudit(base44, { actorUserId: user?.id || 'system', actorName: user?.full_name || 'Counterparty graph job', actorType: user ? 'User' : 'System' }, {
        tenantId: tenant.id, eventType: 'tm_counterparty_graph_built',
        after: { edges: edges.size, created, updated, removed, customer_to_customer: c2c, window_days: WINDOW_DAYS },
        notes: `Counterparty flow graph rebuilt for the last ${WINDOW_DAYS} days: ${edges.size} edges (${c2c} between customers).`,
      });
      results.push({ tenant_id: tenant.id, edges: edges.size, created, updated, removed, customer_to_customer: c2c });
    }
    return Response.json({ ok: true, results });
  } catch (error) {
    return errorResponse(error);
  }
}
