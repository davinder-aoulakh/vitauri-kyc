// fxRateBackfill — Tenant Admin only, own tenant. Input { from, to } (max 120 days) loads the ECB history archive,
// or { csv_text } (columns date, base, quote, rate; optional from/to filter) stores the uploaded rates with source 'CSV'.
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.52';
import { requireTmEnabled } from '../../shared/tmGuards.js';
import { authenticate, errorResponse, httpError, loadTenant } from '../../shared/tmAuth.js';
import { writeAudit } from '../../shared/tmAudit.js';
import { loadEcbHistory, buildRows, parseRatesCsv, parseWindow, upsertRates } from '../../shared/fxEcb.js';

const MAX_DAYS = 120;

export default async function (req) {
  try {
    const base44 = createClientFromRequest(req);
    const body = await req.json().catch(() => ({}));
    const auth = await authenticate(base44, req, body, { roles: ['Tenant Admin'], allowApiKey: false });
    const tenant = await loadTenant(base44, auth.tenantId);
    requireTmEnabled(tenant, 'tm_core');

    let rows;
    let source;
    let win = null;
    if (typeof body.csv_text === 'string' && body.csv_text.trim()) {
      source = 'CSV';
      rows = parseRatesCsv(body.csv_text);
      if (body.from || body.to) {
        win = parseWindow(body, 3660);
        rows = rows.filter((r) => r.date >= win.from && r.date <= win.to);
      }
      if (!rows.length) throw httpError(422, 'No valid rows found. Expected columns: date, base, quote, rate');
    } else {
      source = 'ECB';
      win = parseWindow(body, MAX_DAYS);
      let hist;
      try { hist = await loadEcbHistory(); } catch (e) {
        throw httpError(502, `The ECB history file could not be loaded (${String(e?.message || e).slice(0, 100)}). Upload a CSV instead.`);
      }
      rows = hist.filter((h) => h.date >= win.from && h.date <= win.to).flatMap((h) => buildRows(h.date, h.eur));
      if (!rows.length) throw httpError(404, 'The ECB history has no rates in that window');
    }

    const res = await upsertRates(base44.asServiceRole.entities, auth.tenantId, rows);
    const dates = new Set(rows.map((r) => r.date));
    await writeAudit(base44, auth, {
      tenantId: auth.tenantId, eventType: 'fx_rates_backfilled', before: {},
      after: { source, from: win?.from, to: win?.to, days: dates.size, rows: rows.length, ...res },
      notes: `FX rates backfilled from ${source} (${rows.length} rates over ${dates.size} days).`,
    });
    return Response.json({ source, days: dates.size, rows: rows.length, ...res });
  } catch (error) {
    console.error('fxRateBackfill error:', error?.message);
    return errorResponse(error);
  }
}