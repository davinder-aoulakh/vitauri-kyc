// recomputeFx — Tenant Admin only, own tenant. Input { from, to } (max 366 days).
// Fills fx on fiat transactions in the window that have none, using the stored rates, then re-runs the
// profile deviation logic for the affected clients. Writes one AuditEvent with counts.
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.52';
import { requireTmEnabled } from '../../shared/tmGuards.js';
import { authenticate, errorResponse, loadTenant, chunk } from '../../shared/tmAuth.js';
import { writeAudit } from '../../shared/tmAudit.js';
import { fetchAll } from '../../shared/tmCoverage.js';
import { getRate } from '../../shared/tmFx.js';
import { parseWindow, FX_NULL } from '../../shared/fxEcb.js';

export default async function (req) {
  try {
    const base44 = createClientFromRequest(req);
    const body = await req.json().catch(() => ({}));
    const auth = await authenticate(base44, req, body, { roles: ['Tenant Admin'], allowApiKey: false });
    const tid = auth.tenantId;
    const E = base44.asServiceRole.entities;
    const tenant = await loadTenant(base44, tid);
    requireTmEnabled(tenant, 'tm_core');
    const { from, to } = parseWindow(body, 366);
    const reporting = String(tenant.tm_reporting_currency || 'USD').toUpperCase();

    const txns = await fetchAll((cursor) => E.Transaction.filter({
      tenant_id: tid, currency_kind: 'fiat',
      executed_at: { $gte: `${from}T00:00:00.000Z`, $lte: `${to}T23:59:59.999Z` },
      $or: FX_NULL,
    }, { limit: 1000, cursor }), 30);

    const cache = new Map();
    const updates = [];
    const clients = new Set();
    let stillMissing = 0;
    for (const t of txns) {
      if (t.fx || !t.currency || !t.executed_at || !Number.isFinite(Number(t.amount))) { if (!t.fx) stillMissing++; continue; }
      const ccy = String(t.currency).toUpperCase();
      const ck = `${t.executed_at.slice(0, 10)}|${ccy}`;
      if (!cache.has(ck)) cache.set(ck, await getRate(base44, tid, t.executed_at, ccy, reporting));
      const r = cache.get(ck);
      if (!r) { stillMissing++; continue; }
      updates.push({ id: t.id, fx: { rate: r.rate, rate_date: r.rate_date, reporting_currency: reporting, amount_reporting: Math.round(Number(t.amount) * r.rate * 100) / 100 } });
      if (t.client_id) clients.add(t.client_id);
    }
    for (const part of chunk(updates, 500)) await E.Transaction.bulkUpdate(part);

    let deviation = null;
    if (clients.size) {
      try {
        const res = await base44.functions.invoke('profileDeviationJob', { client_ids: [...clients] });
        deviation = res?.data?.results?.[0] || { ok: true };
      } catch (e) {
        deviation = { error: String(e?.message || e).slice(0, 200) };
      }
    }

    const counts = { from, to, scanned: txns.length, updated: updates.length, still_missing: stillMissing, clients_affected: clients.size, deviation_error: deviation?.error };
    await writeAudit(base44, auth, {
      tenantId: tid, eventType: 'fx_recomputed', before: {}, after: counts,
      notes: `Missing FX recomputed for ${from} to ${to}: ${updates.length} updated, ${stillMissing} still without a rate.`,
    });
    return Response.json({ ...counts, deviation });
  } catch (error) {
    console.error('recomputeFx error:', error?.message);
    return errorResponse(error);
  }
}