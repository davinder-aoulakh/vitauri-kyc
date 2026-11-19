// Guided conversation outreach: the conversation engine (spec sections 5 and 6.1). Pure: no I/O, runs in Deno and node.
// The server (outreachPortal) owns the state and calls these functions; the browser only renders what they return.
//
// State (persisted on OutreachConversation): {
//   block_states: { [block]: { state: 'asked'|'answered'|'skipped'|'off'|'declined'|'deferred', asked_at, answered_at, skip_reason } },
//   queue: [{ block, fu }]        follow-ups still to ask, in order (kept in pending_step.queue)
//   fired: ['block:fu', ...]       follow-ups already triggered (one per trigger)
//   datapoints: { [key]: { key, label, value, display, source, block_key, history: [], test_stub? } }
//   risk, route, legal_form_kind, failed_checks
// }
// A step: { id, block_key, kind: 'block'|'follow_up', fu_id?, widget, text, why?, tag?, options?, multi?, none_option?, facts?,
//           prefill?, datapoint_key?, label?, allow_defer?, checks?, edit_rows? }
import { evaluateCondition } from './outreachConditions.js';
import { fillPlaceholders, minutesLeft } from './outreachSnapshot.js';
import { MESSAGES } from './outreachMessages.js';
import { sameName } from './outreachIdv.js';
import { failedNames, evidenceStatus } from './outreachDocRules.js';

const clone = (v) => JSON.parse(JSON.stringify(v ?? null));
const asList = (v) => (Array.isArray(v) ? v : v === undefined || v === null || v === '' ? [] : [v]);
const DONE_STATES = ['answered', 'skipped', 'off', 'deferred'];
const SOURCE_LABEL = {
  idv: 'Didit ID check', client: 'Declared by client', ai: 'Declared by client, AI follow-up', doc: 'From document', pre: 'Prefilled from invitation',
  kvk: 'KvK trade register', prop: 'Suggested from registry data, confirmed by client', calc: 'Calculated by the tool', rep: 'Declared by the representative',
};
export const sourceLabel = (s) => SOURCE_LABEL[s] || s || '';
const UPLOAD_ACTIONS = ['ask_file'];
export const MAX_RE_REQUESTS = 2;
const ASK_ACTIONS = ['ask_text', 'ask_area', 'ask_choice', 'ai_followup', 'ask_file'];

/** A fresh state for a conversation. */
export function initialState({ risk = 'medium', route = null, legal_form_kind = null } = {}) {
  return { block_states: {}, queue: [], fired: [], answers: {}, datapoints: {}, risk, route, legal_form_kind, failed_checks: [] };
}

function items(snapshot) { return (snapshot?.template_snapshot?.items || []); }
function blockOf(snapshot, key) { return snapshot?.blocks_snapshot?.[key] || null; }

/** Answers per block for the condition language: the client's answer to the block itself (not to its follow-ups). */
export function answersOf(snapshot, state) {
  return { ...(state.answers || {}) };
}
function condCtx(snapshot, state) {
  return { answers: answersOf(snapshot, state), risk: state.risk, route: state.route, legal_form_kind: state.legal_form_kind, failed_checks: state.failed_checks || [] };
}

function stepId(blockKey, fu, n) { return `${blockKey}${fu ? `:${fu}` : ''}:${n}`; }
function askCount(state, blockKey) { return (state.block_states[blockKey]?.asks || 0); }

function idvFacts(state) {
  return ['full_name', 'dob', 'nat', 'doc'].map((k) => state.datapoints[k]).filter(Boolean).map((d) => ({ label: d.label, value: d.display }));
}

/** The step for a block (first ask or re-ask). vars: placeholder values. */
function blockStep(snapshot, state, key, vars) {
  const b = blockOf(snapshot, key);
  const n = askCount(state, key) + 1;
  const step = {
    id: stepId(key, null, n), block_key: key, kind: 'block', widget: b.widget, text: fillPlaceholders(b.question_template, vars), why: b.why_text || null,
    options: b.options || [], multi: !!b.multi || b.widget === 'multi', none_option: b.none_option || null,
  };
  if (b.widget === 'confirm_facts' && key === 'name_confirm') step.facts = idvFacts(state);
  if (key === 'email' && vars.invitation_email) step.prefill = vars.invitation_email;
  if (b.widget === 'upload') { step.checks = b.evidence?.document_checks || []; step.allow_defer = !!b.evidence?.allow_defer; step.datapoint_key = b.datapoints?.[0]?.key; }
  if (b.widget === 'phone') step.validation = b.validation || null;
  if (b.widget === 'review') step.rows = reviewRows(snapshot, state);
  if (b.widget === 'sign') step.declaration = fillPlaceholders(b.variants?.declaration || '', vars);
  return step;
}

function followUpStep(snapshot, state, blockKey, fu, vars, phrased = null) {
  const n = askCount(state, blockKey) + 1;
  const upload = UPLOAD_ACTIONS.includes(fu.action);
  const widget = upload ? 'upload' : fu.action === 'ask_choice' ? 'chips' : fu.action === 'ask_area' ? 'area' : 'text';
  return {
    id: stepId(blockKey, fu.id, n), block_key: blockKey, kind: 'follow_up', fu_id: fu.id, widget,
    text: phrased?.text || fillPlaceholders(fu.question || fu.message || '', vars),
    tag: fu.action === 'ai_followup' ? (phrased?.approver ? fillPlaceholders(MESSAGES.followUpCheckedTag, { name: phrased.approver }) : MESSAGES.followUpTag) : (fu.tag || null),
    ai_assisted: fu.action === 'ai_followup' && !!phrased?.ai,
    options: fu.options || [], datapoint_key: fu.key || null, label: fu.label || null,
    ...(upload ? { checks: fu.document_checks || blockOf(snapshot, blockKey)?.evidence?.document_checks || [], allow_defer: fu.allow_defer === true } : {}),
  };
}

/**
 * Moves to the next step. Returns { state, step | null, done, messages[], events[] } where messages are bank messages to add
 * (the question of the step) and events are audit entries { event, notes, payload }.
 * Order: queued follow-ups first, then the next template item that is not done (inactive -> off, show_if false -> skipped).
 */
export function advance(snapshot, prev, vars = {}) {
  const state = clone(prev);
  const events = [];
  const messages = [];
  const now = vars.now || new Date().toISOString();
  if (state.queue.length) {
    const { block, fu } = state.queue[0];
    const f = (blockOf(snapshot, block)?.follow_ups || []).find((x) => x.id === fu);
    if (f?.action === 'ai_followup' && !state.queue[0].phrased) {
      // AI follow-up (spec 6.2): the server phrases it (setPhrasing) and, for Medium/High, holds it for approval.
      if (state.queue[0].held) {
        const wait = { id: `${block}:${fu}:wait`, block_key: block, kind: 'follow_up', fu_id: fu, widget: 'wait', text: '' };
        return { state, step: wait, done: false, messages, events };
      }
      return { state, step: null, done: false, messages, events, needs_phrasing: { block, fu, default_text: fillPlaceholders(f.question || '', vars), answer: state.answers?.[block] ?? null, label: blockOf(snapshot, block)?.label || block } };
    }
    const step = followUpStep(snapshot, state, block, f, vars, state.queue[0].phrased || null);
    state.block_states[block] = { ...(state.block_states[block] || {}), state: 'asked', asks: askCount(state, block) + 1 };
    // The rule that triggered this follow-up is logged when the follow-up is asked (audit order of spec 12 / transcript A).
    if (!state.queue[0].logged) {
      events.push({ event: 'rule', notes: `Follow-up on ${block}: ${f.label || f.key || f.id}`, payload: { block, follow_up: fu, action: f.action } });
      if (f.action === 'ai_followup' && !state.queue[0].phrased?.approver) events.push({ event: 'ai.followup.auto', notes: `Sent without approval (${state.risk} risk)${state.queue[0].phrased?.ai ? '' : '; default text used'}`, payload: { block, follow_up: fu, ai: !!state.queue[0].phrased?.ai } });
      state.queue[0] = { ...state.queue[0], logged: true };
    }
    events.push({ event: 'block.asked', notes: `${block} (${f.action === 'ai_followup' ? 'follow-up' : UPLOAD_ACTIONS.includes(f.action) ? 'evidence' : f.key || f.id})`, payload: { block, follow_up: fu } });
    messages.push({ author_type: 'bank', kind: f.action === 'ai_followup' ? 'follow_up' : 'message', block_key: block, text: step.text, tag: step.tag || null, ai_assisted: !!step.ai_assisted });
    return { state, step, done: false, messages, events };
  }
  for (const it of items(snapshot)) {
    const key = it.block_key;
    const bs = state.block_states[key];
    if (bs && DONE_STATES.includes(bs.state)) continue;
    if (bs && bs.state === 'asked' && state.pending_block === key) { /* re-entry: ask again below */ }
    const b = blockOf(snapshot, key);
    if (!b) continue;
    if (it.active === false) {
      state.block_states[key] = { state: 'off', skip_reason: 'Switched off in the template' };
      events.push({ event: 'block.skipped', notes: `${key}: switched off in the template`, payload: { block: key, reason: 'off' } });
      continue;
    }
    if (b.show_if && !evaluateCondition(b.show_if, condCtx(snapshot, state))) {
      state.block_states[key] = { state: 'skipped', skip_reason: 'Condition not met' };
      events.push({ event: 'block.skipped', notes: `${key}: condition not met`, payload: { block: key, reason: 'show_if', show_if: b.show_if } });
      continue;
    }
    const step = blockStep(snapshot, state, key, vars);
    state.block_states[key] = { ...(bs || {}), state: 'asked', asked_at: bs?.asked_at || now, asks: askCount(state, key) + 1 };
    state.pending_block = key;
    const prefilled = !!step.prefill || !!step.facts;
    events.push({ event: 'block.asked', notes: `${key}${prefilled ? ' (prefilled)' : b.widget === 'upload' ? ' (upload)' : ''}`, payload: { block: key } });
    messages.push({ author_type: 'bank', kind: 'message', block_key: key, text: step.text, why: step.why });
    return { state, step, done: false, messages, events };
  }
  state.pending_block = null;
  return { state, step: null, done: true, messages, events };
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
function displayOf(widget, v) {
  if (widget === 'multi') return asList(v).join(', ');
  if (widget === 'phone') return `${v?.code || ''} ${v?.number || ''}`.trim();
  if (widget === 'address') return `${v.street} ${v.number}, ${v.postcode} ${v.city}, ${v.country}`;
  if (widget === 'upload') return v?.deferred ? MESSAGES.clientDeferred : (v?.name || '');
  return String(v ?? '');
}

/** Validation per widget. Returns an error message or null. step: the current step; value: the client's answer. */
export function validateAnswer(step, value, state = {}) {
  const w = step.widget;
  if (w === 'idv') return value?.session_done === true || value?.declined === true ? null : MESSAGES.required;
  if (w === 'chips' || w === 'confirm_facts') {
    if (!value) return MESSAGES.chooseOne;
    if ((step.options || []).length && !step.options.includes(value)) return MESSAGES.chooseOne;
    return null;
  }
  if (w === 'multi') {
    const l = asList(value);
    if (!l.length) return MESSAGES.chooseAtLeastOne;
    if (l.some((x) => !(step.options || []).includes(x))) return MESSAGES.chooseAtLeastOne;
    if (step.none_option && l.includes(step.none_option) && l.length > 1) return MESSAGES.chooseAtLeastOne;
    return null;
  }
  if (w === 'text' || w === 'area') {
    const t = String(value ?? '').trim();
    if (!t) return MESSAGES.required;
    if (step.fu_id === 'other_email' && !EMAIL_RE.test(t)) return MESSAGES.emailInvalid;
    return null;
  }
  if (w === 'phone') {
    const digits = String(value?.number || '').replace(/\D/g, '');
    if (!value?.code || digits.length < 8) return step.validation?.message?.match(/"([^"]+)"/)?.[1] || MESSAGES.phoneShort;
    return null;
  }
  if (w === 'address') {
    const ok = value && ['country', 'postcode', 'number', 'street', 'city'].every((k) => String(value[k] ?? '').trim());
    return ok ? null : MESSAGES.addressIncomplete;
  }
  if (w === 'upload') {
    if (value?.deferred) return step.allow_defer ? null : MESSAGES.required;
    return value?.name ? null : MESSAGES.required;
  }
  if (w === 'review') return value === 'confirmed' ? null : MESSAGES.required;
  if (w === 'sign') {
    if (!value?.terms || !String(value?.typed_name || '').trim() || !value?.signature) return MESSAGES.signIncomplete;
    const idName = state.datapoints?.full_name?.display || '';
    if (idName && !sameName(value.typed_name, idName)) return fillPlaceholders(MESSAGES.signNameMismatch, { name: idName });
    return null;
  }
  return null;
}

function labelFor(snapshot, blockKey, key, fallback) {
  return (blockOf(snapshot, blockKey)?.datapoints || []).find((d) => d.key === key)?.label || fallback || key;
}
function sourceFor(snapshot, blockKey, key, fallback = 'client') {
  return (blockOf(snapshot, blockKey)?.datapoints || []).find((d) => d.key === key)?.sources?.[0] || fallback;
}

function putDatapoint(state, dp, now, reason) {
  const prev = state.datapoints[dp.key];
  const history = [...(prev?.history || [])];
  if (prev) history.push({ value: prev.value, display: prev.display, source: prev.source, changed_at: now, reason: reason || 'answered again' });
  state.datapoints[dp.key] = { ...dp, history };
}

/** Follow-ups of a block that are triggered now and have not fired yet, in block order. */
export function triggeredFollowUps(snapshot, state, blockKey) {
  const ctx = condCtx(snapshot, state);
  return (blockOf(snapshot, blockKey)?.follow_ups || []).filter((f) => !state.fired.includes(`${blockKey}:${f.id}`) && evaluateCondition(f.when, ctx));
}

/**
 * Applies the client's answer to the current step. Returns { error } or
 * { state, clientText, messages (after the answer), events, datapoints: [changed keys] }. Call advance() next.
 * extra: { now, invitation_email, idv: { full_name, dob, nat, doc } (Didit result, see outreachIdv.idvFromItem), idv_outcome: 'approved'|'in_review', test_stub }
 */
export function applyAnswer(snapshot, prev, step, value, extra = {}) {
  const err = validateAnswer(step, value, prev);
  if (err) return { error: err };
  const state = clone(prev);
  const now = extra.now || new Date().toISOString();
  const events = [];
  const messages = [];
  const changed = [];
  const key = step.block_key;
  const b = blockOf(snapshot, key);
  let clientText = displayOf(step.widget, value);

  if (step.kind === 'block') {
    if (step.widget === 'idv' && value?.declined) {
      // "Not now": a neutral reply and the same step again (spec 5.3, state `declined`).
      state.block_states[key] = { ...(state.block_states[key] || {}), state: 'declined', declined: (state.block_states[key]?.declined || 0) + 1 };
      events.push({ event: 'block.declined', notes: `${key}: client chose "Not now"`, payload: { block: key } });
      messages.push({ author_type: 'bank', kind: 'message', block_key: key, text: MESSAGES.idvLaterReply });
      return { state, clientText: MESSAGES.clientIdvLater, messages, events, datapoints: changed, reask: true };
    }
    if (step.widget === 'idv') {
      const id = extra.idv || {};
      const inReview = extra.idv_outcome === 'in_review';
      for (const k of ['full_name', 'dob', 'nat', 'doc']) {
        if (!id[k]) continue;
        putDatapoint(state, { key: k, label: labelFor(snapshot, key, k), value: id[k], display: String(id[k]), source: 'idv', block_key: key, ...(inReview ? { status: 'in_review' } : {}), ...(extra.test_stub ? { test_stub: true } : {}) }, now);
        changed.push(k);
      }
      clientText = MESSAGES.clientIdvDone;
      if (inReview) messages.push({ author_type: 'bank', kind: 'message', block_key: key, text: MESSAGES.idvInReview });
      events.push({ event: 'prefill', notes: `Name, date of birth, nationality, document taken from the Didit result${inReview ? ' (in review at Didit)' : ''}`, payload: { keys: changed, outcome: extra.idv_outcome || 'approved' } });
    } else if (step.widget === 'review') {
      clientText = MESSAGES.clientReview;
    } else if (step.widget === 'sign') {
      clientText = MESSAGES.clientSign;
      const d = new Date(now);
      const signed = `Signed ${String(d.getUTCDate()).padStart(2, '0')}/${String(d.getUTCMonth() + 1).padStart(2, '0')}/${d.getUTCFullYear()}`;
      putDatapoint(state, { key: 'declaration', label: labelFor(snapshot, key, 'declaration', 'Declaration and signature'), value: { typed_name: value.typed_name, signed_at: now }, display: signed, source: 'client', block_key: key }, now);
      changed.push('declaration');
    } else {
      state.answers = { ...(state.answers || {}), [key]: value };
      // The block's own datapoint: the first one, unless that key belongs to a follow-up (e.g. name_confirm -> id_dispute).
      const main0 = b.datapoints?.[0];
      const fuKeys = (b.follow_ups || []).map((f) => f.key).filter(Boolean);
      const main = main0 && (main0.key === key || !fuKeys.includes(main0.key)) ? main0 : null;
      if (main) {
        let source = sourceFor(snapshot, key, main.key);
        let v = value;
        if (key === 'email' && value === b.options?.[0]) { v = extra.invitation_email || ''; source = 'pre'; }
        if (key === 'email' && value !== b.options?.[0]) { v = null; } // the follow-up asks for the address
        const raw = step.widget === 'upload' ? null : value;
        if (v !== null) {
          const display = key === 'email' ? String(v) : displayOf(step.widget, value);
          putDatapoint(state, { key: main.key, label: main.label, value: step.widget === 'upload' ? fileValue(value) : v, display, raw_answer: raw, source: step.widget === 'upload' ? 'doc' : source, block_key: key, ...(step.widget === 'upload' && !value?.deferred ? { status: evidenceStatus(value.checks || []) } : {}), ...(value?.deferred ? { status: 'deferred' } : {}) }, now);
          changed.push(main.key);
        } else {
          state.datapoints[main.key] = { ...(state.datapoints[main.key] || {}), key: main.key, label: main.label, block_key: key, raw_answer: value, value: state.datapoints[main.key]?.value ?? null, display: state.datapoints[main.key]?.display ?? '', source: 'client', history: state.datapoints[main.key]?.history || [] };
        }
      }
      if (step.widget === 'upload') uploadEffects(state, key, step, value, b?.label || key, events, extra);
    }
  } else {
    // follow-up answer
    const f = (b.follow_ups || []).find((x) => x.id === step.fu_id);
    if (f?.key) {
      const src = f.action === 'ai_followup' ? 'ai' : UPLOAD_ACTIONS.includes(f.action) ? 'doc' : 'client';
      if (f.merge && state.datapoints[f.key]) {
        // e.g. purpose: replace "Other" by "Other: <text>"
        const cur = asList(state.datapoints[f.key].value).map((x) => (x === 'Other' ? `Other: ${String(value).trim()}` : x));
        putDatapoint(state, { ...state.datapoints[f.key], value: cur, display: cur.join(', ') }, now, 'merged follow-up');
      } else if (f.combine_into) {
        const part = { key: f.key, label: f.label || f.key, value: String(value).trim(), display: String(value).trim(), source: src, block_key: key };
        state.parts = { ...(state.parts || {}), [f.key]: part };
        const parts = Object.values(state.parts).filter((p) => p.block_key === key);
        putDatapoint(state, { key: f.combine_into, label: labelFor(snapshot, key, f.combine_into), value: parts.map((p) => p.value), display: parts.map((p) => p.display).join(' · '), source: src, block_key: key }, now);
        changed.push(f.combine_into);
      } else {
        const isUpload = UPLOAD_ACTIONS.includes(f.action);
        putDatapoint(state, {
          key: f.key, label: labelFor(snapshot, key, f.key, f.label), value: isUpload ? fileValue(value) : (step.widget === 'chips' ? value : String(value).trim()),
          display: displayOf(step.widget, value), source: src, block_key: key, ...(isUpload && !value?.deferred ? { status: evidenceStatus(value.checks || []) } : {}), ...(value?.deferred ? { status: 'deferred' } : {}),
        }, now);
        changed.push(f.key);
        if (isUpload) uploadEffects(state, key, step, value, f.label || f.key, events, extra);
      }
      if (f.action === 'ai_followup') events.push({ event: 'ai.followup.answered', notes: f.key, payload: { block: key, key: f.key } });
    }
    if (f?.then_message) messages.push({ author_type: 'bank', kind: 'message', block_key: key, text: f.then_message });
    state.queue = state.queue.slice(1);
  }

  // Follow-ups triggered by this answer (one per trigger).
  if (step.kind === 'block' || state.queue.length === 0) {
    const fired = triggeredFollowUps(snapshot, state, key);
    for (const f of fired) {
      state.fired.push(`${key}:${f.id}`);
      if (f.action === 're_request') {
        const n = state.block_states[key]?.re_requests || 0;
        if (n >= MAX_RE_REQUESTS) {
          events.push({ event: 'rule', notes: `${key}: check still not met after ${n} new upload(s); the file is kept for manual review`, payload: { block: key, follow_up: f.id, action: 'kept_for_review' } });
          continue;
        }
        events.push({ event: 'rule', notes: `Follow-up on ${key}: ${f.label || f.id} (document check failed)`, payload: { block: key, follow_up: f.id, action: f.action } });
        messages.push({ author_type: 'bank', kind: 'message', block_key: key, text: f.message, tag: f.tag || MESSAGES.documentTag });
        state.block_states[key] = { ...(state.block_states[key] || {}), state: 'not_asked', re_requests: n + 1 };
        state.fired = state.fired.filter((x) => x !== `${key}:${f.id}`);
        state.failed_checks = [];
        return { state, clientText, messages, events, datapoints: changed, reask: true, open_requests: extraOpen(state) };
      }
      if (f.action === 'explain_and_reask' || f.action === 'rule') events.push({ event: 'rule', notes: `Follow-up on ${key}: ${f.label || f.key || f.id}`, payload: { block: key, follow_up: f.id, action: f.action } });
      if (f.action === 'explain_and_reask') {
        messages.push({ author_type: 'bank', kind: 'explanation', block_key: key, text: f.message, tag: f.tag || MESSAGES.explanationTag });
        state.block_states[key] = { ...(state.block_states[key] || {}), state: 'not_asked' };
        // a re-ask: the answer is not final; the trigger may fire again on the next "I don't know"
        state.fired = state.fired.filter((x) => x !== `${key}:${f.id}`);
        return { state, clientText, messages, events, datapoints: changed, reask: true };
      }
      if (f.action === 'rule') continue;
      if (ASK_ACTIONS.includes(f.action) || UPLOAD_ACTIONS.includes(f.action)) state.queue.push({ block: key, fu: f.id });
    }
  }
  if (!state.queue.some((q) => q.block === key)) {
    state.block_states[key] = { ...(state.block_states[key] || {}), state: value?.deferred ? 'deferred' : 'answered', answered_at: now };
    events.push({ event: 'block.answered', notes: key, payload: { block: key } });
  }
  state.failed_checks = [];
  return { state, clientText, messages, events, datapoints: changed, open_requests: extraOpen(state) };
}

function fileValue(v) {
  if (v?.deferred) return { deferred: true };
  return { name: v?.name || '', size: Number(v?.size) || 0, mime: v?.mime || '', evidence_id: v?.evidence_id || null, checks: v?.checks || [] };
}

/** Failed checks feed `document_check_failed`; a deferral asks the portal to open an OutreachOpenRequest. */
function uploadEffects(state, key, step, value, label, events, extra) {
  if (value?.deferred) {
    events.push({ event: 'request.deferred', notes: `${label}: the client will provide this later`, payload: { block: key, follow_up: step.fu_id || null } });
    state.open_new = [...(state.open_new || []), { kind: 'deferred_evidence', title: label, block_key: key }];
    return;
  }
  const checks = value?.checks || [];
  state.failed_checks = failedNames(checks);
  const passed = checks.filter((c) => c.ok === true).length;
  const pending = checks.filter((c) => c.ok === null).length;
  events.push({ event: 'doc.checked', notes: `${label}: ${value?.name || ''} — ${passed} of ${checks.length} checks met${state.failed_checks.length ? `; not met: ${state.failed_checks.join(', ')}` : ''}${pending ? `; ${pending} pending manual review` : ''}`, payload: { block: key, follow_up: step.fu_id || null, evidence_id: value?.evidence_id || null, checks } });
}
function extraOpen(state) { const o = state.open_new || []; delete state.open_new; return o; }

/**
 * The server phrased the queued AI follow-up. mode 'auto' -> asked on the next advance(); 'approval' -> held (wait step)
 * until approvePhrasing(). Counts against the per-request limit.
 */
export function setPhrasing(prev, { text, ai, mode }) {
  const state = clone(prev);
  const q = state.queue[0];
  if (!q) return state;
  state.ai_count = (state.ai_count || 0) + 1;
  if (mode === 'approval') state.queue[0] = { ...q, held: true, proposal: { text, ai: !!ai } };
  else state.queue[0] = { ...q, phrased: { text, ai: !!ai } };
  return state;
}
/** Staff approved the held follow-up (text may be edited or the default). */
export function approvePhrasing(prev, { text, ai, approver }) {
  const state = clone(prev);
  const q = state.queue[0];
  if (!q?.held) return state;
  state.queue[0] = { ...q, held: false, phrased: { text, ai: !!ai, approver: approver || null } };
  return state;
}
/** Over the per-request limit: the queued AI follow-up is not asked. */
export function dropQueued(prev, reason) {
  const state = clone(prev);
  const q = state.queue.shift();
  const events = q ? [{ event: 'rule', notes: `AI follow-up on ${q.block} not asked: ${reason}`, payload: { block: q.block, follow_up: q.fu, action: 'limit' } }] : [];
  if (q && !state.queue.some((x) => x.block === q.block)) state.block_states[q.block] = { ...(state.block_states[q.block] || {}), state: 'answered' };
  return { state, events };
}

/** Review rows grouped by section: value, source label, editable. */
export function reviewRows(snapshot, state) {
  const sections = snapshot?.template_snapshot?.sections || [];
  const sectionOf = (it) => it.section_key || blockOf(snapshot, it.block_key)?.section_key;
  const rows = [];
  for (const it of items(snapshot)) {
    const b = blockOf(snapshot, it.block_key);
    if (!b || ['review', 'sign'].includes(b.widget)) continue;
    for (const dp of Object.values(state.datapoints).filter((d) => d.block_key === it.block_key && d.display)) {
      const editable = !!b.edit && dp.key === b.datapoints?.[0]?.key;
      rows.push({ section: sectionOf(it), section_label: sections.find((s) => s.key === sectionOf(it))?.label || '', key: dp.key, label: dp.label, value: dp.display, source: dp.source, source_label: sourceLabel(dp.source) + (dp.test_stub ? ' (test)' : '') + (dp.status === 'pending' ? ' (pending review)' : ''), editable, edit: editable ? { type: b.edit.type, options: b.options || [], none_option: b.none_option || null } : null });
    }
  }
  return rows;
}

/**
 * An edit in the review: the value is replaced (source becomes "Declared by client"), the old value stays in history,
 * answer.edited is logged and follow-ups that are now triggered for the first time are queued (earlier answers kept).
 */
export function applyEdit(snapshot, prev, datapointKey, value, extra = {}) {
  const state = clone(prev);
  const dp = state.datapoints[datapointKey];
  if (!dp) return { error: 'Unknown answer' };
  const b = blockOf(snapshot, dp.block_key);
  if (!b?.edit || b.datapoints?.[0]?.key !== datapointKey) return { error: 'This answer cannot be changed here' };
  const widget = b.edit.type === 'multi' ? 'multi' : b.edit.type === 'chips' ? 'chips' : 'text';
  const err = validateAnswer({ widget, options: b.options || [], none_option: b.none_option }, value, state);
  if (err) return { error: err };
  const now = extra.now || new Date().toISOString();
  const display = displayOf(widget, value);
  const old = dp.display;
  putDatapoint(state, { ...dp, value: widget === 'text' ? String(value).trim() : value, display, raw_answer: value, source: 'client' }, now, 'edited in review');
  state.answers = { ...(state.answers || {}), [dp.block_key]: value };
  const events = [{ event: 'answer.edited', notes: `${dp.block_key}: "${old}" -> "${display}" (edited in review, previous value kept in history)`, payload: { key: datapointKey, old, new: display } }];
  for (const f of triggeredFollowUps(snapshot, state, dp.block_key)) {
    if (!ASK_ACTIONS.includes(f.action) && !UPLOAD_ACTIONS.includes(f.action)) continue;
    state.fired.push(`${dp.block_key}:${f.id}`);
    state.queue.push({ block: dp.block_key, fu: f.id });
  }
  return { state, events, display, queued: state.queue.length };
}

/** Progress per spec 5.5: active items minus skipped ones; one step per answered block. */
export function progress(snapshot, state, { submitted = false } = {}) {
  const its = items(snapshot);
  const counted = its.filter((it) => it.active !== false && state.block_states[it.block_key]?.state !== 'skipped');
  const total = counted.length;
  const steps = counted.filter((it) => ['answered', 'deferred'].includes(state.block_states[it.block_key]?.state)).length;
  const pct = total ? Math.min(100, Math.round((steps / total) * 100)) : 0;
  return { steps, total, pct, minutes_left: submitted ? 0 : minutesLeft(total, steps) };
}

/** Canonical JSON of the answers (sorted keys, value and source only) — the basis of the submission hash. */
export function canonicalAnswers(state) {
  const keys = Object.keys(state.datapoints || {}).sort();
  return JSON.stringify(keys.map((k) => [k, state.datapoints[k].value ?? null, state.datapoints[k].source || null]));
}
export async function submissionHash(state) {
  const buf = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonicalAnswers(state)));
  return [...new Uint8Array(buf)].map((x) => x.toString(16).padStart(2, '0')).join('');
}
/** Reference number, e.g. NAB-2026-004217. rnd: 0..1 (injectable). */
export function referenceNumber(prefix, now = new Date(), rnd = Math.random()) {
  return `${prefix || 'REF'}-${now.getUTCFullYear()}-${String(Math.floor(rnd * 1e6)).padStart(6, '0')}`;
}

/** Messages after submission: thank-you line and the status card. */
export function submissionMessages({ first_name, response_time, reference }) {
  return [
    { author_type: 'bank', kind: 'message', text: fillPlaceholders(MESSAGES.submitted, { first_name }) },
    { author_type: 'system', kind: 'status_card', text: fillPlaceholders(MESSAGES.statusBody, { response_time }), payload: { title: MESSAGES.statusTitle, reference } },
  ];
}
