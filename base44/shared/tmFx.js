// FX rate lookup for Transaction Monitoring. No external FX calls here (rates are imported by fxRateImport / fxRateBackfill).
// Order: exact date or latest within 7 days, then the USD peg, then the inverse pair, then a cross through EUR or USD.

export const XCG_PER_USD_PEG = 1.79;
const PEGGED = ['XCG', 'ANG'];
const DAY_MS = 86400000;

export function pegRate(from, to) {
  if (from === 'USD' && PEGGED.includes(to)) return XCG_PER_USD_PEG;
  if (PEGGED.includes(from) && to === 'USD') return 1 / XCG_PER_USD_PEG;
  return null;
}

const minusDays = (day, n) => new Date(new Date(day + 'T00:00:00Z').getTime() - n * DAY_MS).toISOString().slice(0, 10);

/** Database finder: latest FxRate row for (from -> to) with minDate <= date <= maxDate. */
export function makeFinder(base44, tenantId) {
  return async (from, to, minDate, maxDate) => {
    const res = await base44.asServiceRole.entities.FxRate.filter(
      { tenant_id: tenantId, base: from, quote: to, date: { $gte: minDate, $lte: maxDate } },
      { sort: '-date', limit: 1 },
    );
    const items = Array.isArray(res) ? res : (res?.items || []);
    return items[0] || null;
  };
}

/**
 * Core resolution, independent of where rows come from. find(from, to, minDate, maxDate) -> row | null.
 * Returns { rate, rate_date, source } or null.
 */
export async function resolveRate(find, from, to, day) {
  if (from === to) return { rate: 1, rate_date: day, source: 'identity' };
  const earliest = minusDays(day, 7);

  const hit = await find(from, to, earliest, day);
  if (hit) return { rate: hit.rate, rate_date: hit.date, source: hit.source || 'fx_table' };

  const peg = pegRate(from, to);
  if (peg) return { rate: peg, rate_date: day, source: 'peg' };

  const inv = await find(to, from, earliest, day);
  if (inv?.rate) return { rate: 1 / inv.rate, rate_date: inv.date, source: 'inverse' };

  const leg = async (f, t) => {
    const d = await find(f, t, earliest, day);
    if (d) return { rate: d.rate, date: d.date };
    const p = pegRate(f, t);
    if (p) return { rate: p, date: day };
    const i = await find(t, f, earliest, day);
    if (i?.rate) return { rate: 1 / i.rate, date: i.date };
    return null;
  };
  for (const pivot of ['EUR', 'USD']) {
    if (pivot === from || pivot === to) continue;
    const l1 = await leg(from, pivot);
    const l2 = l1 ? await leg(pivot, to) : null;
    if (l1 && l2) return { rate: l1.rate * l2.rate, rate_date: l1.date < l2.date ? l1.date : l2.date, source: `cross:${pivot}` };
  }
  return null;
}

/**
 * Returns { rate, rate_date, source } or null (caller records fx = null + warning).
 * Same-currency returns rate 1.
 */
export async function getRate(base44, tenantId, date, from, to) {
  from = String(from || '').toUpperCase();
  to = String(to || '').toUpperCase();
  const day = new Date(date).toISOString().slice(0, 10);
  return resolveRate(makeFinder(base44, tenantId), from, to, day);
}