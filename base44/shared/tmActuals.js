// Rolling-window actuals vs. approved ExpectedProfile — shared by recomputeCustomerRisk, profileDeviationJob and getClientMonitoring.
import { fetchAll } from './tmCoverage.js';
import { getRate } from './tmFx.js';

const DAY_MS = 86400000;
export const OPEN_ALERT_STATUSES = ['new', 'triaged', 'in_review', 'escalated'];
const CASH_CATEGORIES = ['cash_deposit', 'cash_withdrawal'];
const upper = (v) => String(v || '').trim().toUpperCase();

/** Amount in reporting currency (absolute), or null when it cannot be converted. */
export function amountInReporting(t, reportingCurrency) {
  if (t.fx?.amount_reporting != null && (!t.fx.reporting_currency || upper(t.fx.reporting_currency) === upper(reportingCurrency))) {
    return Math.abs(Number(t.fx.amount_reporting) || 0);
  }
  if (!t.currency || upper(t.currency) === upper(reportingCurrency)) return Math.abs(Number(t.amount) || 0);
  return null;
}

/** Booked transactions only: no own-account transfers, no reversed (or reversed-against) bookings. */
export function countableTxns(txns) {
  const reversedAgainst = new Set(txns.filter((t) => t.lifecycle === 'reversed' && t.related_to).map((t) => t.related_to));
  return txns.filter((t) => {
    if (t.own_transfer) return false;
    if (t.lifecycle && !['booked', 'corrected'].includes(t.lifecycle)) return false;
    return !reversedAgainst.has(t.id);
  });
}

export function summariseTxns(txns, { client, reportingCurrency }) {
  const home = upper(client?.country_of_residence || client?.registered_country);
  const out = { inbound: 0, inboundCount: 0, outbound: 0, foreignOut: 0, cash: 0, countries: [], unconverted: 0, txnCount: 0 };
  const countries = new Set();
  for (const t of countableTxns(txns)) {
    const a = amountInReporting(t, reportingCurrency);
    if (a == null) { out.unconverted++; continue; }
    out.txnCount++;
    if (t.counterparty_country) countries.add(upper(t.counterparty_country));
    if (t.direction === 'inbound') { out.inbound += a; out.inboundCount++; } else {
      out.outbound += a;
      if (home && t.counterparty_country && upper(t.counterparty_country) !== home) out.foreignOut += a;
    }
    if (CASH_CATEGORIES.includes(t.category)) out.cash += a;
  }
  out.countries = [...countries];
  return out;
}

export async function loadActuals(base44, { tenantId, client, reportingCurrency, days = 30 }) {
  const since = new Date(Date.now() - days * DAY_MS).toISOString();
  const E = base44.asServiceRole.entities;
  const txns = await fetchAll((cursor) => E.Transaction.filter(
    { tenant_id: tenantId, client_id: client.id, executed_at: { $gte: since } }, { limit: 1000, cursor }), 10);
  return summariseTxns(txns, { client, reportingCurrency });
}

/** Profile limits expressed in the reporting currency (count limit unchanged). Null limit = not set. */
export async function profileLimits(base44, tenantId, profile, reportingCurrency) {
  let factor = 1;
  if (profile.currency && upper(profile.currency) !== upper(reportingCurrency)) {
    const fx = await getRate(base44, tenantId, new Date(), profile.currency, reportingCurrency);
    factor = fx?.rate ?? null;
  }
  const money = (v) => (v == null ? null : factor == null ? null : Number(v) * factor);
  return {
    inbound: money(profile.inbound_max_month),
    inboundCount: profile.inbound_max_count_month ?? null,
    outbound: money(profile.outbound_max_month),
    foreignOut: money(profile.outbound_foreign_max_month),
    cash: money(profile.cash_max_month),
    fxMissing: factor == null,
  };
}

const fmt = (n) => Math.round(n).toLocaleString('en-US');

/** Compare actuals with limits. Returns breaches (actual > limit) and countries outside allowed_countries. */
export function compareToProfile(actuals, limits, allowedCountries, cur) {
  const rows = [
    { key: 'inbound', label: 'Inbound', actual: actuals.inbound, limit: limits.inbound, money: true },
    { key: 'inboundCount', label: 'Inbound count', actual: actuals.inboundCount, limit: limits.inboundCount, money: false },
    { key: 'outbound', label: 'Outbound', actual: actuals.outbound, limit: limits.outbound, money: true },
    { key: 'foreignOut', label: 'Foreign outbound', actual: actuals.foreignOut, limit: limits.foreignOut, money: true },
    { key: 'cash', label: 'Cash', actual: actuals.cash, limit: limits.cash, money: true },
  ];
  const ratios = [];
  const breaches = [];
  for (const r of rows) {
    if (r.limit == null) continue;
    const ratio = r.limit > 0 ? r.actual / r.limit : (r.actual > 0 ? 2 : 0);
    ratios.push({ ...r, ratio });
    if (ratio > 1) {
      const pct = r.limit > 0 ? ` (${Math.round(ratio * 100)}%)` : '';
      breaches.push({
        ...r, ratio,
        reason: r.money
          ? `${r.label} ${cur} ${fmt(r.actual)} vs limit ${fmt(r.limit)}${pct}`
          : `${r.label} ${fmt(r.actual)} vs limit ${fmt(r.limit)}${pct}`,
      });
    }
  }
  const allowed = new Set((allowedCountries || []).map(upper));
  const newCountries = allowed.size ? actuals.countries.filter((c) => !allowed.has(c)) : [];
  return { ratios, breaches, newCountries };
}