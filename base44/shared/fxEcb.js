// ECB reference-rate parsing and FxRate upserts (backend only).
import { unzipSync, strFromU8 } from 'npm:fflate@0.8.2';
import { XCG_PER_USD_PEG } from './tmFx.js';
import { chunk, httpError } from './tmAuth.js';

export const ECB_DAILY_URL = 'https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml';
export const ECB_HIST_URL = 'https://www.ecb.europa.eu/stats/eurofxref/eurofxref-hist.zip';
export const UNIQUE_KEY = ['tenant_id', 'date', 'base', 'quote', 'source'];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const CCY_RE = /^[A-Z]{3}$/;
const r10 = (n) => Number(n.toPrecision(10));

export async function fetchBytes(url, timeoutMs = 20000) {
  const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw httpError(502, `ECB download failed (${res.status})`);
  return new Uint8Array(await res.arrayBuffer());
}

/** Daily XML -> { date, eur: { USD: 1.08, ... } } (units of currency per 1 EUR). */
export function parseEcbDailyXml(xml) {
  const date = /<Cube\s+time=["'](\d{4}-\d{2}-\d{2})["']/.exec(xml)?.[1];
  if (!date) throw httpError(502, 'ECB file has no date');
  const eur = {};
  for (const m of xml.matchAll(/<Cube\s+currency=["']([A-Z]{3})["']\s+rate=["']([\d.]+)["']/g)) {
    const v = Number(m[2]);
    if (v > 0) eur[m[1]] = v;
  }
  if (!eur.USD) throw httpError(502, 'ECB file has no USD rate');
  return { date, eur };
}

/** eurofxref-hist.csv text -> [{ date, eur }] */
export function parseEcbHistCsv(text) {
  const lines = text.split(/\r?\n/).filter(Boolean);
  const header = (lines.shift() || '').split(',').map((s) => s.trim());
  const out = [];
  for (const line of lines) {
    const cols = line.split(',');
    const date = cols[0]?.trim();
    if (!DATE_RE.test(date)) continue;
    const eur = {};
    for (let i = 1; i < header.length; i++) {
      const v = parseFloat(cols[i]);
      if (CCY_RE.test(header[i]) && v > 0) eur[header[i]] = v;
    }
    if (eur.USD) out.push({ date, eur });
  }
  return out;
}

export async function loadEcbHistory() {
  const bytes = await fetchBytes(ECB_HIST_URL, 60000);
  const files = unzipSync(bytes);
  const name = Object.keys(files).find((n) => n.toLowerCase().endsWith('.csv'));
  if (!name) throw httpError(502, 'ECB history archive has no CSV');
  return parseEcbHistCsv(strFromU8(files[name]));
}

/** EUR-base rows, USD-base rows derived from the EUR crosses, and EUR<->XCG/ANG via the USD peg. */
export function buildRows(date, eur) {
  const rows = [];
  const add = (base, quote, rate) => { if (Number.isFinite(rate) && rate > 0) rows.push({ date, base, quote, rate: r10(rate), source: 'ECB' }); };
  const usd = eur.USD;
  for (const [ccy, v] of Object.entries(eur)) {
    add('EUR', ccy, v);
    if (ccy !== 'USD') add('USD', ccy, v / usd);
  }
  add('USD', 'EUR', 1 / usd);
  for (const peg of ['XCG', 'ANG']) {
    add('EUR', peg, usd * XCG_PER_USD_PEG);
    add(peg, 'EUR', 1 / (usd * XCG_PER_USD_PEG));
  }
  return rows;
}

/** CSV with columns date, base, quote, rate (header optional, comma or semicolon). */
export function parseRatesCsv(text, max = 5000) {
  const rows = [];
  for (const line of String(text || '').split(/\r?\n/)) {
    const c = line.split(/[;,]/).map((s) => s.trim().replace(/^"|"$/g, ''));
    if (c.length < 4 || !DATE_RE.test(c[0])) continue;
    const base = c[1].toUpperCase();
    const quote = c[2].toUpperCase();
    const rate = Number(c[3]);
    if (CCY_RE.test(base) && CCY_RE.test(quote) && base !== quote && rate > 0) rows.push({ date: c[0], base, quote, rate: r10(rate), source: 'CSV' });
    if (rows.length > max) throw httpError(413, `CSV has more than ${max} rates`);
  }
  return rows;
}

/** from/to (YYYY-MM-DD) validated, to not in the future, at most maxDays wide. */
export function parseWindow(body, maxDays) {
  const { from, to } = body || {};
  if (!DATE_RE.test(String(from)) || !DATE_RE.test(String(to))) throw httpError(400, 'from and to must be YYYY-MM-DD');
  const days = (new Date(`${to}T00:00:00Z`) - new Date(`${from}T00:00:00Z`)) / 86400000;
  if (!(days >= 0)) throw httpError(400, 'from must be on or before to');
  if (days + 1 > maxDays) throw httpError(400, `Choose a window of at most ${maxDays} days`);
  if (to > new Date().toISOString().slice(0, 10)) throw httpError(400, 'to cannot be in the future');
  return { from, to };
}

/** Upsert rows for one tenant; (tenant_id, date, base, quote, source) is the unique key. */
export async function upsertRates(E, tenantId, rows) {
  let created = 0;
  let updated = 0;
  for (const part of chunk(rows.map((r) => ({ ...r, tenant_id: tenantId })), 500)) {
    const res = await E.FxRate.upsert(part, { key: UNIQUE_KEY });
    created += Number(res?.created) || 0;
    updated += Number(res?.updated) || 0;
  }
  return { created, updated };
}

/** Mongo-style filter for transactions that should have an fx block but do not. */
export const FX_NULL = [{ fx: { $exists: false } }, { fx: null }];