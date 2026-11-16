// Frontend copy of base44/shared/tmProfileSources.js (keep both in step).
// Expected profile: where each value comes from, and the gap between what the client declared and what is proposed
// (phase 10, gap G20). Pure: no I/O. A copy lives in src/lib (kept in step by tests/shared-copies.test.js).

export const PROFILE_SOURCES = ['kyc_case', 'kyc_txn_analysis', 'manual', 'tm_review', 'client_declaration', 'segment_default'];
export const FIELD_SOURCE_LABEL = {
  client_declaration: 'Client declaration', kyc_txn_analysis: 'Transaction analysis', manual: 'Analyst', segment_default: 'Segment default',
};
export const LIMIT_FIELDS = ['inbound_max_month', 'outbound_max_month', 'max_single_txn', 'cash_max_month'];
export const GAP_TOLERANCE = 0.25;

// DEMO VALUES (decision D10: real values come from Compliance). Monthly amounts in the tenant's reporting currency.
export const DEFAULT_SEGMENT_LIMITS = {
  NP_Low: { inbound_max_month: 5000, outbound_max_month: 5000, max_single_txn: 2500, cash_max_month: 500 },
  NP_Medium: { inbound_max_month: 7500, outbound_max_month: 7500, max_single_txn: 5000, cash_max_month: 500 },
  NP_High: { inbound_max_month: 10000, outbound_max_month: 10000, max_single_txn: 5000, cash_max_month: 0 },
  ORG_Low: { inbound_max_month: 50000, outbound_max_month: 50000, max_single_txn: 25000, cash_max_month: 1000 },
  ORG_Medium: { inbound_max_month: 100000, outbound_max_month: 100000, max_single_txn: 50000, cash_max_month: 1000 },
  ORG_High: { inbound_max_month: 100000, outbound_max_month: 100000, max_single_txn: 25000, cash_max_month: 0 },
};
export const SEGMENT_KEYS = Object.keys(DEFAULT_SEGMENT_LIMITS);

function settingsOf(tenant) {
  const s = tenant?.tm_settings;
  if (!s) return {};
  if (typeof s === 'string') { try { return JSON.parse(s) || {}; } catch { return {}; } }
  return typeof s === 'object' ? s : {};
}
const num = (v) => { const n = Number(v); return Number.isFinite(n) && n >= 0 && v !== '' && v !== null && v !== undefined ? n : undefined; };

/** Segment of a customer: person or organisation, by official risk class (Unacceptable and unrated use High / Medium). */
export function segmentOf(client) {
  const type = client?.client_type === 'ORG' ? 'ORG' : 'NP';
  const rc = client?.risk_classification;
  const cls = rc === 'Low' ? 'Low' : rc === 'High' || rc === 'Unacceptable' ? 'High' : 'Medium';
  return `${type}_${cls}`;
}

/** Segment limits: the tenant's values (tm_settings.segment_defaults) over the demo defaults, numbers only. */
export function segmentDefaults(tenant) {
  const own = settingsOf(tenant).segment_defaults || {};
  const out = {};
  for (const key of SEGMENT_KEYS) {
    out[key] = {};
    for (const f of LIMIT_FIELDS) {
      const v = num(own[key]?.[f]);
      out[key][f] = v !== undefined ? v : DEFAULT_SEGMENT_LIMITS[key][f];
    }
  }
  return out;
}

/** The limits the client's own statements about expected use lead to (subset of limitsFromBehavior().fields). */
export function declaredValues(behaviorFields) {
  const out = {};
  for (const f of LIMIT_FIELDS) { const v = num(behaviorFields?.[f]); if (v !== undefined) out[f] = v; }
  return out;
}

/**
 * Fill the limits that are still empty from the segment default.
 * Returns { fields, filled: [keys] }; values already present are never changed.
 */
export function fillFromSegment(fields, client, tenant) {
  const seg = segmentDefaults(tenant)[segmentOf(client)] || {};
  const out = { ...(fields || {}) };
  const filled = [];
  for (const f of LIMIT_FIELDS) {
    if (num(out[f]) === undefined && num(seg[f]) !== undefined) { out[f] = seg[f]; filled.push(f); }
  }
  return { fields: out, filled };
}

/** Per limit: which source the value came from. `analysisFields` / `declared` / `segmentFilled` describe the inputs. */
export function fieldSources({ fields, declared, analysisFields, segmentFilled, overrides }) {
  const out = {};
  for (const f of LIMIT_FIELDS) {
    if (num(fields?.[f]) === undefined) continue;
    if (overrides && overrides[f] !== undefined) out[f] = 'manual';
    else if ((segmentFilled || []).includes(f)) out[f] = 'segment_default';
    else if (analysisFields && num(analysisFields[f]) !== undefined) out[f] = 'kyc_txn_analysis';
    else if (declared && num(declared[f]) !== undefined && Number(declared[f]) === Number(fields[f])) out[f] = 'client_declaration';
    else out[f] = 'manual';
  }
  return out;
}

/** The profile's overall source when the caller did not name one: all from one place, else the caller's default. */
export function overallSource(sources, fallback) {
  const kinds = [...new Set(Object.values(sources || {}))];
  if (kinds.length === 1 && ['client_declaration', 'segment_default'].includes(kinds[0])) return kinds[0];
  return fallback;
}

/**
 * The gap is a finding: limits where the proposed value differs from the client's declaration by more than the
 * tolerance (default 25%). Returns { fields: [{ field, declared, proposed, ratio, direction }], tolerance } or null.
 */
export function profileGap(declared, proposed, tolerance = GAP_TOLERANCE) {
  const rows = [];
  for (const f of LIMIT_FIELDS) {
    const d = num(declared?.[f]); const p = num(proposed?.[f]);
    if (d === undefined || p === undefined) continue;
    if (d === 0 && p === 0) continue;
    const ratio = d === 0 ? null : Math.round((p / d) * 100) / 100;
    const off = d === 0 ? p > 0 : Math.abs(p - d) / d > tolerance;
    if (off) rows.push({ field: f, declared: d, proposed: p, ratio, direction: p > d ? 'above' : 'below' });
  }
  return rows.length ? { fields: rows, tolerance } : null;
}
