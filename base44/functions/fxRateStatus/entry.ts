// fxRateStatus — read model for Tenant Config > TM settings > FX rates (Compliance Admin / Tenant Admin, own tenant).
// Returns the latest ECB import, the currencies seen in fiat transactions, a 30-day rate table (1 unit -> reporting currency)
// and the number of fiat transactions without fx.
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.52';
import { requireTmEnabled } from '../../shared/tmGuards.js';
import { authenticate, errorResponse, loadTenant, asList } from '../../shared/tmAuth.js';
import { fetchAll } from '../../shared/tmCoverage.js';
import { resolveRate } from '../../shared/tmFx.js';
import { FX_NULL } from '../../shared/fxEcb.js';

const DAY_MS = 86400000;
const iso = (ms) => new Date(ms).toISOString().slice(0, 10);

export default async function (req) {
  try {
    const base44 = createClientFromRequest(req);
    const body = await req.json().catch(() => ({}));
    const auth = await authenticate(base44, req, body, { roles: ['Tenant Admin', 'Compliance Admin'], allowApiKey: false });
    const tid = auth.tenantId;
    const E = base44.asServiceRole.entities;
    const tenant = await loadTenant(base44, tid);
    requireTmEnabled(tenant, 'tm_core');
    const reporting = String(tenant.tm_reporting_currency || 'USD').toUpperCase();

    const now = Date.now();
    const days = Array.from({ length: 30 }, (_, i) => iso(now - i * DAY_MS));
    const [latest, ccyRes, fxMissing, rateRows] = await Promise.all([
      E.FxRate.filter({ tenant_id: tid, base: 'EUR', quote: 'USD', source: 'ECB' }, { sort: '-date', limit: 1 }).then(asList),
      E.Transaction.filter({ tenant_id: tid, currency_kind: 'fiat' }, { distinct: 'currency', limit: 100 }),
      E.Transaction.count({ tenant_id: tid, currency_kind: 'fiat', $or: FX_NULL }),
      fetchAll((cursor) => E.FxRate.filter({ tenant_id: tid, date: { $gte: iso(now - 38 * DAY_MS) } }, { sort: '-date', limit: 1000, cursor }), 10),
    ]);

    const byPair = new Map();
    for (const r of rateRows) {
      const k = `${r.base}|${r.quote}`;
      if (!byPair.has(k)) byPair.set(k, []);
      byPair.get(k).push(r);
    }
    const find = async (f, q, min, max) => byPair.get(`${f}|${q}`)?.find((r) => r.date >= min && r.date <= max) || null;

    const currencies = asList(ccyRes).map((c) => String(c).toUpperCase()).filter((c) => /^[A-Z]{3}$/.test(c) && c !== reporting).sort();
    const table = [];
    for (const day of days) {
      const rates = {};
      for (const c of currencies) rates[c] = (await resolveRate(find, c, reporting, day))?.rate ?? null;
      table.push({ date: day, rates });
    }
    return Response.json({
      reporting_currency: reporting, currencies, table, fx_missing: Number(fxMissing) || 0,
      latest_import: latest[0] ? { date: latest[0].date, source: latest[0].source, imported_at: latest[0].updated_date || latest[0].created_date } : null,
    });
  } catch (error) {
    console.error('fxRateStatus error:', error?.message);
    return errorResponse(error);
  }
}