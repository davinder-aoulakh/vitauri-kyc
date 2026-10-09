// FX rate lookup for Transaction Monitoring. No external FX calls.

export const XCG_PER_USD_PEG = 1.79;

function pegRate(from, to) {
  if (from === 'USD' && to === 'XCG') return XCG_PER_USD_PEG;
  if (from === 'XCG' && to === 'USD') return 1 / XCG_PER_USD_PEG;
  return null;
}

async function findRate(base44, tenantId, from, to, minDate, maxDate) {
  const res = await base44.asServiceRole.entities.FxRate.filter(
    { tenant_id: tenantId, base: from, quote: to, date: { $gte: minDate, $lte: maxDate } },
    { sort: '-date', limit: 1 },
  );
  const items = Array.isArray(res) ? res : (res?.items || []);
  return items[0] || null;
}

/**
 * Returns { rate, rate_date, source } or null (caller records fx = null + warning).
 * Same-currency returns rate 1.
 */
export async function getRate(base44, tenantId, date, from, to) {
  from = String(from || '').toUpperCase();
  to = String(to || '').toUpperCase();
  const day = new Date(date).toISOString().slice(0, 10);
  if (from === to) return { rate: 1, rate_date: day, source: 'identity' };

  const earliest = new Date(new Date(day + 'T00:00:00Z').getTime() - 7 * 86400000).toISOString().slice(0, 10);
  const hit = await findRate(base44, tenantId, from, to, earliest, day);
  if (hit) return { rate: hit.rate, rate_date: hit.date, source: hit.source || 'fx_table' };

  const peg = pegRate(from, to);
  if (peg) return { rate: peg, rate_date: day, source: 'peg' };
  return null;
}