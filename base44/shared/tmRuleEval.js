// Local evaluation of a rule against OUR OWN transactions, used only to count how many known reported cases a rule
// would have caught (Didit's backtest returns counts, not transaction ids). Supports the common fields; anything else
// makes the result "unsupported" rather than guessed.
const MIN = 60000;
const UNIT = { m: MIN, h: 60 * MIN, d: 1440 * MIN };

const UNSUPPORTED_FIELDS = ['subject_payment_method_type', 'subject_country'];
export function unsupportedReason(def) {
  const used = [...def.conditions.map((c) => c.field), ...def.aggregation.flatMap((a) => [a.field, ...Object.keys(a.filters || {})])].filter(Boolean);
  const bad = used.find((f) => UNSUPPORTED_FIELDS.includes(f) || f.startsWith('custom_values.'));
  if (bad) return `The rule uses "${bad}", which is not stored on our transactions.`;
  if (def.conditions.some((c) => c.operator === 'fuzzy_match')) return 'The rule uses fuzzy matching, which cannot be replayed locally.';
  return '';
}

const valueOf = (t, f) => ({
  amount: t.amount, currency: t.currency, direction: String(t.direction || '').toUpperCase(),
  counterparty_country: t.counterparty_country, transaction_type: t.transaction_category || 'finance',
  subject_vendor_data: t.client_id, counterparty_vendor_data: t.counterparty_id || t.counterparty_account_id || t.counterparty_name,
}[f]);

function compare(op, left, right) {
  if (op === 'in') return (Array.isArray(right) ? right : [right]).some((x) => String(x) === String(left));
  if (op === 'not_in') return !(Array.isArray(right) ? right : [right]).some((x) => String(x) === String(left));
  if (op === 'regex') { try { return new RegExp(right).test(String(left ?? '')); } catch { return false; } }
  if (['gt', 'gte', 'lt', 'lte'].includes(op)) {
    if (left == null || right == null) return false;
    return { gt: left > right, gte: left >= right, lt: left < right, lte: left <= right }[op];
  }
  if (op === 'ne') return String(left) !== String(right);
  return String(left) === String(right);
}

const time = (t) => new Date(t.executed_at || t.created_date).getTime();

function aggregate(a, t, pool) {
  const ms = Number(a.window.slice(0, -1)) * UNIT[a.window.slice(-1)];
  const end = time(t);
  const rows = pool.filter((x) => x.id !== t.id && time(x) < end && time(x) >= end - ms && Object.entries(a.filters || {}).every(([k, v]) => {
    const want = v === '__current__' ? valueOf(t, k) : v;
    const have = valueOf(x, k);
    return Array.isArray(want) ? want.map(String).includes(String(have)) : String(have) === String(want);
  }));
  const vals = rows.map((x) => Number(valueOf(x, a.field || 'amount'))).filter(Number.isFinite);
  const metric = { count: rows.length, sum: vals.reduce((s, v) => s + v, 0), min: vals.length ? Math.min(...vals) : 0, max: vals.length ? Math.max(...vals) : 0,
    avg: vals.length ? vals.reduce((s, v) => s + v, 0) / vals.length : 0,
    distinct_count: new Set(rows.map((x) => valueOf(x, a.field || 'counterparty_vendor_data')).filter((v) => v != null)).size }[a.metric];
  return compare(a.operator, metric, a.value);
}

/** True when the rule would match transaction t, given the same client's other transactions in `pool`. */
export function matches(def, t, pool) {
  if (!def.scope.transaction_types.includes(valueOf(t, 'transaction_type'))) return false;
  if (!def.scope.directions.includes(valueOf(t, 'direction'))) return false;
  const results = def.conditions.map((c) => compare(c.operator, valueOf(t, c.field), c.value));
  const condOk = !results.length || (def.evaluation_mode === 'ANY' ? results.some(Boolean) : results.every(Boolean));
  return condOk && def.aggregation.every((a) => aggregate(a, t, pool));
}