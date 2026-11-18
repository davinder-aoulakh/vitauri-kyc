// Guided conversation outreach: the condition language of build spec 5.4 (show_if on a block, `when` on a follow-up).
// Pure: no I/O, runs in Deno and node. A copy lives in src/lib for the editor preview (tests/shared-copies.test.js).
//
//   { answer_includes: { block, value } }   the block's answer (list or text) contains the value
//   { answer_equals:   { block, value } }   the block's answer is exactly the value
//   { risk_in: ['medium', 'high'] }         the request's current risk class
//   { legal_form_kind: 'partnership' }      company | partnership | sole
//   { route: 'nl' }                         nl | document
//   { document_check_failed: 'Name matches your ID' }
//   { calculated: 'no owner reaches threshold' }
//   { all: [..] }, { any: [..] }, { not: {..} }
// Context: { answers: { [block]: value }, risk, route, legal_form_kind, failed_checks: [names], calculations: { [name]: bool } }
// An empty condition is true. A condition on a block that has no answer is false. Unknown operators are invalid (validateCondition)
// and evaluate to false, so a typo never shows a block by accident.

export const CONDITION_OPERATORS = ['answer_includes', 'answer_equals', 'risk_in', 'legal_form_kind', 'route', 'document_check_failed', 'calculated', 'all', 'any', 'not'];
export const RISK_CLASSES = ['low', 'medium', 'high'];
export const LEGAL_FORM_KINDS = ['company', 'partnership', 'sole'];
export const ROUTES = ['nl', 'document'];

const norm = (v) => String(v ?? '').trim().toLowerCase();
const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const isEmpty = (c) => c === undefined || c === null || c === true || (isObj(c) && Object.keys(c).length === 0);

function answerOf(ctx, block) {
  const a = ctx?.answers || {};
  return Object.prototype.hasOwnProperty.call(a, block) ? a[block] : undefined;
}
function listOf(v) {
  if (Array.isArray(v)) return v.map(norm);
  if (v && typeof v === 'object') return Object.values(v).flatMap(listOf);
  return v === undefined || v === null || v === '' ? [] : [norm(v)];
}

/** Evaluates a condition against the conversation context. */
export function evaluateCondition(cond, ctx = {}) {
  if (isEmpty(cond)) return true;
  if (!isObj(cond)) return false;
  const keys = Object.keys(cond);
  if (keys.length !== 1) return keys.every((k) => evaluateCondition({ [k]: cond[k] }, ctx)); // several keys = all of them
  const [op] = keys;
  const arg = cond[op];
  switch (op) {
    case 'all': return Array.isArray(arg) && arg.every((c) => evaluateCondition(c, ctx));
    case 'any': return Array.isArray(arg) && arg.some((c) => evaluateCondition(c, ctx));
    case 'not': return isObj(arg) ? !evaluateCondition(arg, ctx) : false;
    case 'answer_includes': {
      if (!isObj(arg) || !arg.block) return false;
      const a = answerOf(ctx, arg.block);
      return a !== undefined && listOf(a).includes(norm(arg.value));
    }
    case 'answer_equals': {
      if (!isObj(arg) || !arg.block) return false;
      const a = answerOf(ctx, arg.block);
      if (a === undefined) return false;
      const l = listOf(a);
      return l.length === 1 && l[0] === norm(arg.value);
    }
    case 'risk_in': return Array.isArray(arg) && arg.map(norm).includes(norm(ctx.risk));
    case 'legal_form_kind': return !!ctx.legal_form_kind && norm(arg) === norm(ctx.legal_form_kind);
    case 'route': return !!ctx.route && norm(arg) === norm(ctx.route);
    case 'document_check_failed': return (ctx.failed_checks || []).map(norm).includes(norm(arg));
    case 'calculated': return ctx.calculations?.[arg] === true;
    default: return false;
  }
}

/** Problems in a condition (empty list = valid). blockKeys: known block keys, to report a condition on an unknown block. */
export function validateCondition(cond, blockKeys = null, path = 'condition') {
  if (isEmpty(cond)) return [];
  if (!isObj(cond)) return [`${path}: must be an object`];
  const out = [];
  for (const [op, arg] of Object.entries(cond)) {
    const here = `${path}.${op}`;
    if (!CONDITION_OPERATORS.includes(op)) { out.push(`${here}: unknown operator`); continue; }
    if (op === 'all' || op === 'any') {
      if (!Array.isArray(arg) || !arg.length) out.push(`${here}: needs a list of conditions`);
      else arg.forEach((c, i) => out.push(...validateCondition(c, blockKeys, `${here}[${i}]`)));
    } else if (op === 'not') {
      if (!isObj(arg)) out.push(`${here}: needs one condition`); else out.push(...validateCondition(arg, blockKeys, here));
    } else if (op === 'answer_includes' || op === 'answer_equals') {
      if (!isObj(arg) || !arg.block) out.push(`${here}: needs a block`);
      else if (blockKeys && !blockKeys.includes(arg.block)) out.push(`${here}: unknown block "${arg.block}"`);
      if (isObj(arg) && (arg.value === undefined || arg.value === '')) out.push(`${here}: needs a value`);
    } else if (op === 'risk_in') {
      if (!Array.isArray(arg) || !arg.length || !arg.every((r) => RISK_CLASSES.includes(norm(r)))) out.push(`${here}: list of low, medium, high`);
    } else if (op === 'legal_form_kind') {
      if (!LEGAL_FORM_KINDS.includes(norm(arg))) out.push(`${here}: company, partnership or sole`);
    } else if (op === 'route') {
      if (!ROUTES.includes(norm(arg))) out.push(`${here}: nl or document`);
    } else if (!String(arg ?? '').trim()) out.push(`${here}: needs a value`);
  }
  return out;
}

/** Readable text for staff, e.g. `"sof" includes "Salary" and risk is high`. */
export function describeCondition(cond) {
  if (isEmpty(cond)) return 'Always';
  if (!isObj(cond)) return 'Invalid condition';
  const parts = Object.entries(cond).map(([op, arg]) => {
    const sub = (list, word) => (Array.isArray(list) && list.length ? list.map((c) => { const t = describeCondition(c); return Object.keys(c || {}).length === 1 && !['all', 'any'].includes(Object.keys(c)[0]) ? t : `(${t})`; }).join(` ${word} `) : 'Invalid condition');
    switch (op) {
      case 'all': return sub(arg, 'and');
      case 'any': return sub(arg, 'or');
      case 'not': return `not (${describeCondition(arg)})`;
      case 'answer_includes': return `"${arg?.block}" includes "${arg?.value}"`;
      case 'answer_equals': return `"${arg?.block}" is "${arg?.value}"`;
      case 'risk_in': return `risk is ${(arg || []).join(' or ')}`;
      case 'legal_form_kind': return `legal form is ${arg}`;
      case 'route': return `route is ${arg}`;
      case 'document_check_failed': return `document check failed: "${arg}"`;
      case 'calculated': return `calculation: ${arg}`;
      default: return `unknown operator "${op}"`;
    }
  });
  return parts.join(' and ');
}

/** Block keys a condition refers to (for the editor and for the seed check). */
export function conditionBlocks(cond, out = new Set()) {
  if (!isObj(cond)) return out;
  for (const [op, arg] of Object.entries(cond)) {
    if (op === 'all' || op === 'any') (Array.isArray(arg) ? arg : []).forEach((c) => conditionBlocks(c, out));
    else if (op === 'not') conditionBlocks(arg, out);
    else if ((op === 'answer_includes' || op === 'answer_equals') && arg?.block) out.add(arg.block);
  }
  return out;
}
