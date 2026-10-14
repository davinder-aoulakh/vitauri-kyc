// Allow-list, validation and normalisation of Didit transaction-monitoring rules (Management API v3 /transactions/rules/).
// Stored definitions are Didit-native, so what we validate is exactly what we push.
import { httpError } from './tmAuth.js';

export const MANAGE_ROLES = ['Compliance Admin', 'Compliance Officer']; // tmManageRules
export const APPROVE_ROLES = ['Compliance Officer', 'Compliance Admin', 'Tenant Admin']; // tmApproveRules

// Vitauri-friendly aliases -> Didit field names.
const ALIASES = { country: 'subject_country', payment_method: 'subject_payment_method_type', transaction_category: 'transaction_type' };
export const FIELDS = [
  'amount', 'direction', 'currency', 'subject_country', 'counterparty_country', 'subject_payment_method_type',
  'transaction_type', 'subject_vendor_data', 'counterparty_vendor_data',
];
export const OPERATORS = ['eq', 'neq', 'ne', 'gt', 'gte', 'lt', 'lte', 'in', 'not_in', 'regex', 'fuzzy_match'];
export const AGG_OPERATORS = ['eq', 'ne', 'gt', 'gte', 'lt', 'lte'];
export const METRICS = ['count', 'sum', 'min', 'max', 'avg', 'distinct_count'];
export const ACTION_TYPES = ['add_score', 'add_tags'];
export const CATEGORIES = ['finance', 'aml_ctf', 'anomaly_detection', 'fatf'];
const TXN_TYPES = ['finance', 'kyc', 'travel_rule', 'user_event'];
const DIRECTIONS = ['INBOUND', 'OUTBOUND'];
const WINDOW_MAX = { m: 10080, h: 720, d: 365 };
const TOP_KEYS = ['title', 'name', 'description', 'category', 'evaluation_mode', 'scope', 'conditions', 'aggregation', 'actions'];

export const MODE_MAP = { active: 'ACTIVE', test: 'TEST', disabled: 'DISABLED', retired: 'DISABLED', draft: 'DISABLED' };

const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);
const str = (v) => (typeof v === 'string' ? v.trim() : v);

function canonField(raw, where, errs, { allowCustom = true } = {}) {
  const f = String(raw ?? '').trim();
  if (ALIASES[f]) return ALIASES[f];
  if (FIELDS.includes(f)) return f;
  if (allowCustom && /^custom_values\.[A-Za-z0-9_]{1,40}$/.test(f)) return f;
  errs.push(`${where}: field "${f}" is not allowed (allowed: ${[...FIELDS, 'country', 'payment_method', 'transaction_category', 'custom_values.<key>'].join(', ')})`);
  return null;
}

function scalar(v, where, errs) {
  if (typeof v === 'string' && v.length <= 200) return v.trim();
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'boolean') return v;
  errs.push(`${where}: value must be a short text, number or true/false`);
  return null;
}

const num = (v) => (typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN);
const normDir = (field, v) => (field === 'direction' && typeof v === 'string' ? v.toUpperCase() : v);

function checkCondition(c, i, errs) {
  const where = `conditions[${i}]`;
  if (!isObj(c)) { errs.push(`${where} must be an object`); return null; }
  for (const k of Object.keys(c)) if (!['field', 'operator', 'op', 'value', 'score'].includes(k)) errs.push(`${where}: unknown key "${k}"`);
  const field = canonField(c.field, where, errs);
  const operator = String(c.operator ?? c.op ?? '').trim().toLowerCase();
  if (!OPERATORS.includes(operator)) { errs.push(`${where}: operator "${operator}" is not allowed (allowed: ${OPERATORS.filter((o) => o !== 'ne').join(', ')})`); return null; }
  const op = operator === 'neq' ? 'ne' : operator;
  let value;
  if (['gt', 'gte', 'lt', 'lte'].includes(op)) {
    value = num(c.value);
    if (!Number.isFinite(value)) errs.push(`${where}: "${op}" needs a number`);
  } else if (op === 'in' || op === 'not_in') {
    const arr = Array.isArray(c.value) ? c.value : [c.value];
    if (!arr.length || arr.length > 50) errs.push(`${where}: "${op}" needs 1 to 50 values`);
    value = arr.map((x) => normDir(field, scalar(x, where, errs)));
  } else if (op === 'regex') {
    value = typeof c.value === 'string' ? c.value : '';
    try { new RegExp(value); } catch { errs.push(`${where}: invalid regular expression`); }
    if (!value || value.length > 200) errs.push(`${where}: regex must be 1 to 200 characters`);
  } else {
    value = normDir(field, scalar(c.value, where, errs));
  }
  if (field === 'direction') {
    for (const d of Array.isArray(value) ? value : [value]) if (!DIRECTIONS.includes(d)) errs.push(`${where}: direction must be INBOUND or OUTBOUND`);
  }
  const out = { field, operator: op, value };
  if (op === 'fuzzy_match') {
    const score = num(c.score);
    if (!(score >= 0 && score <= 100)) errs.push(`${where}: fuzzy_match needs a score from 0 to 100`);
    out.score = score;
  }
  return out;
}

function checkAggregation(a, i, errs) {
  const where = `aggregation[${i}]`;
  if (!isObj(a)) { errs.push(`${where} must be an object`); return null; }
  for (const k of Object.keys(a)) if (!['metric', 'field', 'operator', 'value', 'window', 'filters'].includes(k)) errs.push(`${where}: unknown key "${k}"`);
  const metric = String(a.metric ?? 'count').trim().toLowerCase();
  if (!METRICS.includes(metric)) errs.push(`${where}: metric "${metric}" is not allowed (allowed: ${METRICS.join(', ')})`);
  const operator = String(a.operator ?? 'gte').trim().toLowerCase();
  const op = operator === 'neq' ? 'ne' : operator;
  if (!AGG_OPERATORS.includes(op)) errs.push(`${where}: operator "${operator}" is not allowed (allowed: ${AGG_OPERATORS.join(', ')})`);
  const value = num(a.value);
  if (!Number.isFinite(value)) errs.push(`${where}: value must be a number`);
  const win = String(a.window ?? '').trim();
  const m = /^([1-9]\d{0,4})(m|h|d)$/.exec(win);
  if (!m || Number(m[1]) > WINDOW_MAX[m[2]]) errs.push(`${where}: window "${win}" is not valid (examples: 15m, 24h, 7d, 30d)`);
  const out = { metric, operator: op, value, window: win };
  if (metric !== 'count') {
    const f = a.field ? canonField(a.field, `${where}.field`, errs) : (metric === 'distinct_count' ? 'counterparty_vendor_data' : 'amount');
    out.field = f;
  }
  const filters = {};
  if (a.filters !== undefined && !isObj(a.filters)) errs.push(`${where}: filters must be an object`);
  for (const [k, v] of Object.entries(isObj(a.filters) ? a.filters : {})) {
    const f = canonField(k, `${where}.filters`, errs);
    if (!f) continue;
    const list = Array.isArray(v) ? v : [v];
    const vals = list.map((x) => normDir(f, scalar(x, `${where}.filters.${k}`, errs)));
    filters[f] = Array.isArray(v) ? vals : vals[0];
  }
  out.filters = filters;
  return out;
}

function checkAction(a, i, errs) {
  const where = `actions[${i}]`;
  if (!isObj(a)) { errs.push(`${where} must be an object`); return null; }
  if (!ACTION_TYPES.includes(a.type)) { errs.push(`${where}: action "${a.type}" is not allowed (allowed: ${ACTION_TYPES.join(', ')})`); return null; }
  for (const k of Object.keys(a)) if (!['type', 'value', 'tag_name', 'tag_color'].includes(k)) errs.push(`${where}: unknown key "${k}"`);
  if (a.type === 'add_score') {
    const v = num(a.value);
    if (!Number.isInteger(v) || v < -100 || v > 100) errs.push(`${where}: add_score needs a whole number from -100 to 100`);
    return { type: 'add_score', value: v };
  }
  const tag = String(a.tag_name ?? a.value ?? '').trim();
  if (!tag || tag.length > 40) errs.push(`${where}: add_tags needs a tag_name of 1 to 40 characters`);
  return { type: 'add_tags', tag_name: tag };
}

/** Validates + normalises a rule definition. Throws httpError(422, ...) listing every problem. */
export function validateDefinition(input) {
  const errs = [];
  if (!isObj(input)) throw httpError(422, 'The rule must be a JSON object');
  for (const k of Object.keys(input)) if (!TOP_KEYS.includes(k)) errs.push(`Unknown key "${k}" (allowed: title, description, category, evaluation_mode, scope, conditions, aggregation, actions)`);

  const title = str(input.title ?? input.name);
  if (typeof title !== 'string' || title.length < 3 || title.length > 120) errs.push('title must be 3 to 120 characters');
  const category = input.category ? String(input.category).trim() : 'aml_ctf';
  if (!CATEGORIES.includes(category)) errs.push(`category "${category}" is not allowed (allowed: ${CATEGORIES.join(', ')})`);
  const evaluation_mode = String(input.evaluation_mode ?? 'ALL').trim().toUpperCase();
  if (!['ALL', 'ANY'].includes(evaluation_mode)) errs.push('evaluation_mode must be ALL or ANY');
  const description = input.description === undefined ? '' : String(input.description).slice(0, 600);

  const sc = input.scope === undefined ? {} : input.scope;
  if (!isObj(sc)) errs.push('scope must be an object');
  const scope = { transaction_types: ['finance'], directions: [...DIRECTIONS] };
  if (isObj(sc)) {
    for (const k of Object.keys(sc)) if (!['transaction_types', 'directions'].includes(k)) errs.push(`scope: unknown key "${k}"`);
    if (sc.transaction_types !== undefined) {
      const t = Array.isArray(sc.transaction_types) ? sc.transaction_types : [];
      if (!t.length || t.some((x) => !TXN_TYPES.includes(x))) errs.push(`scope.transaction_types must be a non-empty list from ${TXN_TYPES.join(', ')}`);
      else scope.transaction_types = t;
    }
    if (sc.directions !== undefined) {
      const d = (Array.isArray(sc.directions) ? sc.directions : []).map((x) => String(x).toUpperCase());
      if (!d.length || d.some((x) => !DIRECTIONS.includes(x))) errs.push('scope.directions must be a non-empty list of INBOUND / OUTBOUND');
      else scope.directions = d;
    }
  }

  const list = (v, name, max) => {
    if (v === undefined) return [];
    if (!Array.isArray(v)) { errs.push(`${name} must be a list`); return []; }
    if (v.length > max) errs.push(`${name} may have at most ${max} entries`);
    return v.slice(0, max);
  };
  const conditions = list(input.conditions, 'conditions', 12).map((c, i) => checkCondition(c, i, errs)).filter(Boolean);
  const aggregation = list(input.aggregation, 'aggregation', 6).map((a, i) => checkAggregation(a, i, errs)).filter(Boolean);
  const actions = list(input.actions, 'actions', 6).map((a, i) => checkAction(a, i, errs)).filter(Boolean);
  if (!conditions.length && !aggregation.length) errs.push('The rule needs at least one condition or aggregation');
  if (!actions.length) errs.push('The rule needs at least one action');

  if (errs.length) {
    const shown = errs.slice(0, 8).join('; ');
    throw httpError(422, `The rule is not valid: ${shown}${errs.length > 8 ? `; and ${errs.length - 8} more` : ''}`);
  }
  return { title, description, category, evaluation_mode, scope, conditions, aggregation, actions };
}

/** Body for POST/PATCH /v3/transactions/rules/. Didit titles are unique per application, so the version is part of it. */
export function toDiditPayload(rule, diditMode) {
  const d = rule.definition;
  return {
    title: `${d.title} (v${rule.version || 1})`,
    description: [d.description, `Managed by Vitauri. Do not edit in the Didit console.`].filter(Boolean).join(' ').slice(0, 900),
    category: d.category, mode: diditMode, evaluation_mode: d.evaluation_mode, scope: d.scope,
    conditions: d.conditions, aggregation: d.aggregation, actions: d.actions,
  };
}

const sortKeys = (v) => (Array.isArray(v) ? v.map(sortKeys) : isObj(v) ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, sortKeys(v[k])])) : v);
const asNum = (v) => (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v)) ? Number(v) : v);
const sortedList = (arr) => arr.map((x) => JSON.stringify(sortKeys(x))).sort();
const upper = (s) => String(s || '').toUpperCase();

/** Projection of a rule (ours or Didit's response) onto the keys Vitauri manages, in a comparable shape. */
export function normalizeForCompare(r) {
  if (!r) return null;
  const cond = (r.conditions || []).map((c) => ({ field: c.field, operator: c.operator === 'neq' ? 'ne' : c.operator, value: Array.isArray(c.value) ? [...c.value].map(asNum).sort() : asNum(c.value), ...(c.operator === 'fuzzy_match' ? { score: asNum(c.score) } : {}) }));
  const agg = (r.aggregation || []).map((a) => ({
    metric: a.metric || 'count', ...(a.metric && a.metric !== 'count' ? { field: a.field } : {}), operator: a.operator || 'eq', value: asNum(a.value), window: a.window || '1d',
    filters: Object.fromEntries(Object.entries(a.filters || {}).map(([k, v]) => [k, Array.isArray(v) ? [...v].sort() : v])),
  }));
  const act = (r.actions || []).map((a) => (a.type === 'add_score' ? { type: 'add_score', value: asNum(a.value) } : a.type === 'add_tags' ? { type: 'add_tags', tag_name: String(a.tag_name ?? a.value ?? '').toUpperCase() } : { type: a.type }));
  return {
    evaluation_mode: upper(r.evaluation_mode || 'ALL'),
    scope: { transaction_types: [...(r.scope?.transaction_types || [])].sort(), directions: [...(r.scope?.directions || [])].map(upper).sort() },
    conditions: sortedList(cond), aggregation: sortedList(agg), actions: sortedList(act),
  };
}

/** Names of the parts that differ between two normalised rules ([] when equal). */
export function diffParts(a, b) {
  return ['evaluation_mode', 'scope', 'conditions', 'aggregation', 'actions'].filter((k) => JSON.stringify(sortKeys(a?.[k])) !== JSON.stringify(sortKeys(b?.[k])));
}

export const definitionKey = (d) => JSON.stringify(sortKeys(d || {}));