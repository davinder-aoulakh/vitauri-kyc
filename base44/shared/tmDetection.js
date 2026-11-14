// Detection in Vitauri (decision D8): structuring and rapid in/out are checked against our own ledger after an upload,
// because the patterns need backdated transactions in the right order. Pure: no I/O.
// Every threshold comes from tenant settings (tm_settings.detection); the defaults below are the prototype's demo
// values and must be set by Compliance before go-live (decision D10).
import { countableTxns } from './tmActuals.js';

const DAY = 86400000;
const HOUR = 3600000;
export const RISK_CLASSES = ['Low', 'Medium', 'High', 'PEP'];

export const DETECTION_DEFAULTS = {
  enabled: false, // tm_settings.detection_in_vitauri
  structuring: { amount_min: 1750, amount_below: 2000, window_days: 7, senders_by_class: { Low: 5, Medium: 4, High: 3, PEP: 3 } },
  rapid: { window_hours: 48, min_ratio: 0.8, min_out_amount: 0, foreign_only: true, ignore_inbound_references: ['SALARIS', 'SALARY', 'LOON'] },
  profile_coc_mode: 'structural', // 'structural' (N months above the ceiling) | 'first_overrun'
  profile_coc_months: 2,
};

function settingsOf(tenant) {
  const s = tenant?.tm_settings;
  if (!s) return {};
  if (typeof s === 'string') { try { return JSON.parse(s) || {}; } catch { return {}; } }
  return typeof s === 'object' ? s : {};
}
const num = (v, d, { min = 0 } = {}) => (Number.isFinite(Number(v)) && v !== '' && v !== null && Number(v) >= min ? Number(v) : d);
const int = (v, d, min = 1) => (Number.isInteger(Number(v)) && Number(v) >= min ? Number(v) : d);

/** Effective detection settings for a tenant: defaults overlaid with tm_settings. */
export function detectionSettings(tenant) {
  const s = settingsOf(tenant);
  const d = s.detection && typeof s.detection === 'object' ? s.detection : {};
  const D = DETECTION_DEFAULTS;
  const st = d.structuring || {}; const rp = d.rapid || {};
  const senders = {};
  for (const c of RISK_CLASSES) senders[c] = int(st.senders_by_class?.[c], D.structuring.senders_by_class[c], 2);
  return {
    enabled: s.detection_in_vitauri === true,
    structuring: {
      amount_min: num(st.amount_min, D.structuring.amount_min), amount_below: num(st.amount_below, D.structuring.amount_below),
      window_days: int(st.window_days, D.structuring.window_days), senders_by_class: senders,
    },
    rapid: {
      window_hours: int(rp.window_hours, D.rapid.window_hours), min_ratio: num(rp.min_ratio, D.rapid.min_ratio, { min: 0.01 }),
      min_out_amount: num(rp.min_out_amount, D.rapid.min_out_amount), foreign_only: rp.foreign_only !== false,
      ignore_inbound_references: Array.isArray(rp.ignore_inbound_references) ? rp.ignore_inbound_references.map(String).filter(Boolean) : D.rapid.ignore_inbound_references,
    },
    profile_coc_mode: ['structural', 'first_overrun'].includes(s.profile_coc_mode) ? s.profile_coc_mode : D.profile_coc_mode,
    profile_coc_months: int(s.profile_coc_months, D.profile_coc_months),
  };
}

/** Low | Medium | High | PEP. A PEP is its own class; an unknown or "Unacceptable" rating is treated as High. */
export function riskClassOf(client, { pep = false } = {}) {
  if (pep) return 'PEP';
  const r = String(client?.risk_classification || '').trim();
  if (r === 'Low' || r === 'Medium') return r;
  return r ? 'High' : 'Medium';
}

/** ISO-2 country from "NL", "Netherlands (NL)" or a 3-letter code's first letters is NOT guessed: unknown → ''. */
export function iso2(value) {
  const v = String(value ?? '').trim();
  if (/^[A-Za-z]{2}$/.test(v)) return v.toUpperCase();
  const m = v.match(/\(([A-Za-z]{2})\)\s*$/);
  return m ? m[1].toUpperCase() : '';
}

const at = (t) => new Date(t.executed_at).getTime();
const sender = (t) => String(t.counterparty_account_id || t.counterparty_id || t.counterparty_name || '').toUpperCase().replace(/\s/g, '');
const day = (ms) => new Date(ms).toISOString().slice(0, 10);
const eur = (n) => Math.round(n).toLocaleString('en-US');

/**
 * Structuring: several different senders each paying an amount just under a threshold within a few days.
 * Historical transactions count inside the window, but a window made of historical transactions only raises nothing.
 * Returns findings [{ code, key, from, to, senders, total, transaction_ids, reason, score, executed_at }].
 */
export function detectStructuring(txns, cfg, riskClass) {
  const c = cfg.structuring;
  const need = c.senders_by_class[riskClass] ?? c.senders_by_class.Medium;
  const band = countableTxns(txns)
    .filter((t) => t.direction === 'inbound' && t.amount >= c.amount_min && t.amount < c.amount_below && sender(t))
    .sort((a, b) => at(a) - at(b));
  const out = [];
  let i = 0;
  while (i < band.length) {
    const start = at(band[i]);
    const win = band.filter((t) => at(t) >= start && at(t) <= start + c.window_days * DAY);
    const senders = new Set(win.map(sender));
    if (senders.size >= need && win.some((t) => !t.historical)) {
      const last = win[win.length - 1];
      const total = win.reduce((s, t) => s + t.amount, 0);
      out.push({
        code: 'structuring', scenario_code: 'S-07a', key: `structuring:${day(start)}`,
        from: day(start), to: day(at(last)), senders: senders.size, total: Math.round(total * 100) / 100,
        transaction_ids: win.map((t) => t.id).filter(Boolean), executed_at: last.executed_at, score: 72,
        title: 'Structuring under threshold, several senders',
        reason: `${senders.size} different senders in ${c.window_days} days (${day(start)} to ${day(at(last))}), each ${eur(c.amount_min)} to under ${eur(c.amount_below)}, total ${eur(total)} (threshold for ${riskClass}: ${need} senders)`,
      });
      i = band.findIndex((t) => at(t) > at(last));
      if (i < 0) break;
    } else i++;
  }
  return out;
}

/**
 * Rapid in/out: an outgoing payment that passes on most of what came in shortly before.
 * Only non-historical outgoing payments are tested. homeCountry: ISO-2 of the customer.
 */
export function detectRapidInOut(txns, cfg, homeCountry) {
  const c = cfg.rapid;
  const home = iso2(homeCountry);
  const ignore = c.ignore_inbound_references.map((p) => String(p).toUpperCase());
  const ignored = (t) => { const ref = `${t.reference || ''} ${t.description_raw || ''}`.toUpperCase(); return ignore.some((p) => ref.includes(p)); };
  const rows = countableTxns(txns);
  const ins = rows.filter((t) => t.direction === 'inbound' && !ignored(t));
  const out = [];
  for (const o of rows.filter((t) => t.direction === 'outbound' && !t.historical && t.amount >= c.min_out_amount).sort((a, b) => at(a) - at(b))) {
    const cc = iso2(o.counterparty_country);
    if (c.foreign_only && (!cc || !home || cc === home)) continue;
    const before = ins.filter((t) => at(o) - at(t) >= 0 && at(o) - at(t) <= c.window_hours * HOUR);
    const inSum = before.reduce((s, t) => s + t.amount, 0);
    if (inSum <= 0 || o.amount < c.min_ratio * inSum) continue;
    const pct = Math.round((o.amount / inSum) * 100);
    out.push({
      code: 'rapid_in_out', scenario_code: 'S-11', key: `rapid_in_out:${o.id || `${day(at(o))}:${o.amount}`}`,
      date: day(at(o)), amount: o.amount, received: Math.round(inSum * 100) / 100, pct, country: cc || null,
      transaction_ids: [...before.map((t) => t.id), o.id].filter(Boolean), executed_at: o.executed_at, score: 74,
      title: `Rapid in/out within ${c.window_hours} h`,
      reason: `${pct}% of ${eur(inSum)} received was sent on${cc ? ` to ${cc}` : ''}${o.counterparty_name ? ` (${o.counterparty_name})` : ''} within ${c.window_hours} h: ${eur(o.amount)} on ${day(at(o))}`,
    });
  }
  return out;
}

/** Inbound per calendar month ("YYYY-MM" → amount) for countable transactions; amountOf converts to the profile currency. */
export function monthlyInbound(txns, amountOf = (t) => t.amount) {
  const by = {};
  for (const t of countableTxns(txns)) {
    if (t.direction !== 'inbound') continue;
    const a = amountOf(t);
    if (a == null) continue;
    const m = String(t.executed_at).slice(0, 7);
    by[m] = (by[m] || 0) + a;
  }
  return by;
}

/** The last `months` completed calendar months before `now`, newest first ("YYYY-MM"). */
export function completedMonths(now, months) {
  const out = [];
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  for (let i = 0; i < months; i++) { d.setUTCMonth(d.getUTCMonth() - 1); out.push(d.toISOString().slice(0, 7)); }
  return out;
}

/**
 * Decision D7: does a profile overrun become a change of circumstances?
 *   first_overrun: yes, as soon as there is a breach;
 *   structural:    only when inbound was above the ceiling in each of the last N completed months.
 */
export function profileCocDue({ mode, months, hasBreach, inboundByMonth, inboundLimit, now }) {
  if (!hasBreach) return false;
  if (mode === 'first_overrun') return true;
  if (inboundLimit == null) return false;
  return completedMonths(now, months).every((m) => (inboundByMonth[m] || 0) > inboundLimit);
}

/** Alert source for a Didit decision (gap G14): 'didit_provider' when only counterparty-screening presets fired. */
export function alertSourceFor(ruleRuns) {
  const fired = (ruleRuns || []).filter((r) => r && (r.rule_id || r.name));
  if (!fired.length) return 'didit_rule';
  const provider = (r) => /counterparty/i.test(`${r.name || ''} ${r.title || ''}`) && /(sanction|pep|adverse|screening|exposure)/i.test(`${r.name || ''} ${r.title || ''} ${r.category || ''}`);
  return fired.every(provider) ? 'didit_provider' : 'didit_rule';
}
