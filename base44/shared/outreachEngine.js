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
import { effectiveShares, ubos as uboList, structureTree, structureText, normName } from './outreachUbo.js';
import { legalFormKind } from './outreachLegalForm.js';
import { slug } from './outreachParties.js';

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
const ASK_ACTIONS = ['ask_text', 'ask_area', 'ask_choice', 'ai_followup', 'ask_file', 'ask_people', 'ask_file_per_person'];

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
  return { answers: answersOf(snapshot, state), risk: state.risk, route: state.route, legal_form_kind: state.legal_form_kind, failed_checks: state.failed_checks || [], calculations: state.calculations || {} };
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
  return orgBlockStep(snapshot, state, key, vars, step);
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
  if (state.stopped) return { state, step: null, done: false, paused: true, messages, events };
  if (state.queue.length) {
    const { block, fu } = state.queue[0];
    const f = (blockOf(snapshot, block)?.follow_ups || []).find((x) => x.id === fu);
    if (state.queue[0].kind || f?.action === 'ask_file_per_person' || f?.action === 'ask_people') {
      const org = orgQueueStep(snapshot, state, vars, now);
      if (org) return { state: org.state, step: org.step, done: false, messages: org.messages, events: org.events };
      return advance(snapshot, org === null ? state : state, vars); // the entry was dropped (no people): continue
    }
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
    if ((vars.pause_before || []).includes(key)) {
      state.pending_block = null;
      return { state, step: null, done: false, paused: true, messages, events };
    }
    const step = blockStep(snapshot, state, key, vars);
    for (const m of step.pre_messages || []) messages.push(m);
    for (const e of step.pre_events || []) events.push(e);
    delete step.pre_messages; delete step.pre_events;
    state.block_states[key] = { ...(bs || {}), state: 'asked', asked_at: bs?.asked_at || now, asks: askCount(state, key) + 1 };
    state.pending_block = key;
    const prefilled = !!step.prefill || !!step.facts;
    events.push({ event: 'block.asked', notes: `${key}${prefilled ? ' (prefilled)' : b.widget === 'upload' ? ' (upload)' : ''}`, payload: { block: key } });
    if (step.text) messages.push({ author_type: 'bank', kind: 'message', block_key: key, text: step.text, why: step.why, tag: step.tag || null, ai_assisted: !!step.ai_assisted });
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
  if (widget === 'people_list') return asList(v).map((p) => p.name + (p.authority || p.note ? ` (${[p.authority, p.note].filter(Boolean).join(', ')})` : '')).join(', ');
  if (widget === 'owners_builder') return asList(v).map((o) => `${o.name} ${Number(o.pct)}%`).join(', ');
  if (widget === 'form') return Object.values(v || {}).filter(Boolean).join(', ');
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
  if (w === 'people_list') {
    const l = Array.isArray(value) ? value.filter((p) => String(p?.name || '').trim()) : [];
    return l.length ? null : MESSAGES.peopleRequired;
  }
  if (w === 'owners_builder') {
    const l = Array.isArray(value) ? value.filter((o) => String(o?.name || '').trim()) : [];
    if (!l.length) return MESSAGES.peopleRequired;
    if (l.some((o) => !(Number(o.pct) > 0 && Number(o.pct) <= 100))) return MESSAGES.sharesInvalid;
    if (l.reduce((t, o) => t + Number(o.pct), 0) > 100.0001) return MESSAGES.ownersOver;
    return null;
  }
  if (w === 'form') {
    const keys = (step.fields || []).map((f) => f.key);
    return value && keys.every((k) => String(value[k] ?? '').trim()) ? null : MESSAGES.required;
  }
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
  const org = orgApply(snapshot, state, step, value, extra, { now, events, messages, changed });
  if (org) return org;

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


// ── Organisation (ORG) blocks — phase 6a: document route, people, ownership and UBO ───────────────────────────────
// The registry block runs as sub-steps (state.reg.stage): extract upload -> confirm what the AI read -> (correct) -> articles.
// Owners of a company and per-person documents are queue entries with a `kind`. Texts come from the block (variants) or,
// where the pack has them only in prose, from outreachMessages.js.

const ORG_PEOPLE_FIELDS = ['legal_name', 'reg_no', 'legal_form', 'co_address'];
const routeDoc = (b) => b?.variants?.route_document || {};
const fmtList = (l) => asList(l).join(', ');
const ownerVars = (vars) => ({ ...vars, ownerListThreshold: vars.ownerListThreshold ?? 10, uboThreshold: vars.uboThreshold ?? 25 });

function orgBlockStep(snapshot, state, key, vars, step) {
  const b = blockOf(snapshot, key);
  const v = ownerVars(vars);
  if (b.widget === 'registry_search') {
    // 6a: every country takes the document route (providers arrive in 6b)
    const rd = routeDoc(b);
    const st = state.reg?.stage || 'extract';
    const n = askCount(state, key) + 1;
    const base = { ...step, id: `${key}:${st}:${n}`, why: b.why_text || null, sub: st };
    if (st === 'extract') {
      const pre = !state.reg?.intro_done ? [{ author_type: 'bank', kind: 'message', block_key: key, text: fillPlaceholders(rd.intro || '', { ...v, country: state.country || '' }) }] : [];
      return { ...base, widget: 'upload', text: rd.steps?.[0]?.ask || '', checks: rd.steps?.[0]?.document_checks || [], allow_defer: false, read_extract: true, datapoint_key: 'doc_extract', pre_messages: pre };
    }
    if (st === 'confirm') {
      const c = rd.steps?.[1]?.confirm || {};
      const facts = ORG_PEOPLE_FIELDS.concat(['co_activity', 'reg_date', 'co_status']).map((k) => state.datapoints[k]).filter((d) => d && d.display).map((d) => ({ label: d.label, value: d.display }));
      return { ...base, widget: 'confirm_facts', text: c.question || '', tag: c.tag || null, ai_assisted: c.ai_label !== false, options: c.options || [], facts, note: c.note || null };
    }
    if (st === 'correct') {
      return { ...base, widget: 'form', text: MESSAGES.correctExtract, fields: ORG_PEOPLE_FIELDS.map((k) => ({ key: k, label: labelFor(snapshot, key, k), value: state.datapoints[k]?.display || '' })) };
    }
    return { ...base, widget: 'upload', text: rd.steps?.[2]?.ask || '', checks: rd.steps?.[2]?.document_checks || [], allow_defer: false, datapoint_key: 'doc_articles' };
  }
  if (b.widget === 'people_list') {
    const officers = asList(state.reg?.officers);
    const text = officers.length ? (state.route === 'nl' ? b.variants?.question_nl : b.variants?.question_document) : b.variants?.question_empty;
    return { ...step, text: fillPlaceholders(text || '', v), people: officers.map((o) => ({ name: o.name, role: o.role || 'Director', authority: o.authority_text || o.authority || '', source: state.route === 'nl' ? 'prop' : 'doc' })), default_role: 'Director', mode: 'directors' };
  }
  if (b.widget === 'owners_builder') {
    const text = state.legal_form_kind === 'partnership' ? b.variants?.question_partnership : (state.route === 'nl' ? b.variants?.question_nl : b.variants?.question_company);
    return { ...step, text: fillPlaceholders(text || '', v), mode: state.legal_form_kind === 'partnership' ? 'partners' : 'owners', threshold: v.ownerListThreshold, rest_note: fillPlaceholders(MESSAGES.ownersRest, v), over_note: MESSAGES.ownersOver };
  }
  if (key === 'ubo') {
    const tree = orgTree(state, v.uboThreshold);
    const facts = tree.ubos.map((n) => ({ label: n, value: `${tree.shares[n]}%` }));
    return {
      ...step, text: fillPlaceholders(step.text, v), facts,
      pre_messages: [{ author_type: 'system', kind: 'structure_card', block_key: key, text: structureText(tree), payload: { title: MESSAGES.structureTitle, caption: fillPlaceholders(MESSAGES.structureCaption, v), tree } }],
      pre_events: [{ event: 'ubo.calculated', notes: tree.ubos.length ? tree.ubos.map((n) => `${n} ${tree.shares[n]}%`).join('; ') : `No owner reaches ${v.uboThreshold}%`, payload: { shares: tree.shares, ubos: tree.ubos, threshold: v.uboThreshold } }],
    };
  }
  return step;
}

function orgTree(state, threshold) {
  const owners = asList(state.datapoints.owners?.value);
  const chain = {};
  for (const [k, d] of Object.entries(state.datapoints)) if (k.startsWith('chain_') && d.value?.company) chain[d.value.company] = asList(d.value.owners);
  const entity = state.datapoints.legal_name?.display || '';
  const directors = asList(state.datapoints.directors?.value).map((x) => x.name);
  return structureTree({ entity, owners, chain, directors, threshold });
}

/** The step for a queued ORG entry (people with authority, a document per person, owners of a company). null: dropped. */
function orgQueueStep(snapshot, prevState, vars, now) {
  const state = prevState;
  const q = state.queue[0];
  const v = ownerVars(vars);
  const b = blockOf(snapshot, q.block);
  const f = (b?.follow_ups || []).find((x) => x.id === q.fu);
  const n = askCount(state, q.block) + 1;
  const events = [];
  const messages = [];
  const ask = (step) => {
    state.block_states[q.block] = { ...(state.block_states[q.block] || {}), state: 'asked', asks: n };
    if (!q.logged && f) { events.push({ event: 'rule', notes: `Follow-up on ${q.block}: ${f.label || f.key || f.id}`, payload: { block: q.block, follow_up: q.fu, action: f.action } }); state.queue[0] = { ...q, logged: true }; }
    events.push({ event: 'block.asked', notes: `${q.block} (${step.note_label || step.fu_id})`, payload: { block: q.block, follow_up: step.fu_id } });
    messages.push({ author_type: 'bank', kind: 'message', block_key: q.block, text: step.text });
    return { state, step, messages, events };
  };
  if (f?.action === 'ask_people') {
    const fields = asList(f.fields);
    const authField = fields.find((x) => /^authority/i.test(x)) || '';
    const options = (authField.match(/\(([^)]*)\)/)?.[1] || '').split('|').map((x) => x.trim()).filter(Boolean);
    return ask({ id: stepId(q.block, q.fu, n), block_key: q.block, kind: 'follow_up', fu_id: q.fu, widget: 'people_list', mode: 'reps', text: fillPlaceholders(f.question || '', v), people: [], authority_options: options, note_field: fields.find((x) => /role|limit/i.test(x)) ? 'note' : null, datapoint_key: f.key, note_label: 'authorised reps' });
  }
  if (f?.action === 'ask_file_per_person' && !q.person) {
    // one upload per person named in the block's people follow-up
    const peopleFu = (b.follow_ups || []).find((x) => x.action === 'ask_people');
    const people = asList(state.datapoints[peopleFu?.key]?.value).map((p) => p.name).filter(Boolean);
    state.queue.shift();
    state.queue.unshift(...people.map((name) => ({ block: q.block, fu: q.fu, person: name })));
    if (!people.length) return null;
    return orgQueueStep(snapshot, state, vars, now);
  }
  if (f?.action === 'ask_file_per_person') {
    const name = q.person;
    return ask({ id: stepId(q.block, `${q.fu}:${slug(name)}`, n), block_key: q.block, kind: 'follow_up', fu_id: q.fu, person: name, widget: 'upload', text: fillPlaceholders(f.question || '', { ...v, name }), checks: asList(f.document_checks).map((c) => fillPlaceholders(c, { name })), allow_defer: f.allow_defer === true, datapoint_key: `auth_doc_${slug(name)}`, label: fillPlaceholders(labelFor(snapshot, q.block, 'auth_doc_{slug}', 'Authority of {name}'), { name }), note_label: 'authority evidence' });
  }
  if (q.kind === 'company_reg') {
    return ask({ id: stepId(q.block, `company_reg:${slug(q.company)}`, n), block_key: q.block, kind: 'follow_up', fu_id: 'company_reg', company: q.company, widget: 'text', text: fillPlaceholders(MESSAGES.companyRegistered, { ...v, name: q.company }), note_label: `registration of ${q.company}` });
  }
  if (q.kind === 'company_owners') {
    return ask({ id: stepId(q.block, `company_owners:${slug(q.company)}`, n), block_key: q.block, kind: 'follow_up', fu_id: 'company_owners', company: q.company, widget: 'owners_builder', mode: 'owners', text: fillPlaceholders(MESSAGES.companyOwners, { ...v, name: q.company }), threshold: v.ownerListThreshold, rest_note: fillPlaceholders(MESSAGES.ownersRest, v), over_note: MESSAGES.ownersOver, note_label: `owners of ${q.company}` });
  }
  state.queue.shift();
  return null;
}

/** ORG answers. Returns the applyAnswer result, or null when the generic handling applies. */
function orgApply(snapshot, state, step, value, extra, ctx) {
  const { now, events, messages, changed } = ctx;
  const key = step.block_key;
  const b = blockOf(snapshot, key);
  const v = ownerVars(extra.vars || {});
  const done = (clientText, opts = {}) => {
    if (opts.reask) state.block_states[key] = { ...(state.block_states[key] || {}), state: 'not_asked' };
    else if (!state.queue.some((q) => q.block === key)) { state.block_states[key] = { ...(state.block_states[key] || {}), state: 'answered', answered_at: now }; events.push({ event: 'block.answered', notes: key, payload: { block: key } }); }
    state.failed_checks = [];
    return { state, clientText, messages, events, datapoints: changed, ...(opts.reask ? { reask: true } : {}), open_requests: extraOpen(state) };
  };
  const put = (k, value2, display, source, extraDp = {}) => { putDatapoint(state, { key: k, label: extraDp.label || labelFor(snapshot, key, k), value: value2, display, source, block_key: key, ...extraDp }, now); changed.push(k); };

  // country: the route (6a: always the document route) and the stop for a blocked jurisdiction; then the generic handling
  if (key === 'country' && (step.kind === 'follow_up' || value !== (b?.options || []).slice(-1)[0])) {
    state.country = String(value).trim();
    state.route = 'document';
    const blocked = asList(extra.blockedJurisdictions).map((x) => String(x).toLowerCase()).includes(state.country.toLowerCase());
    events.push({ event: 'route.selected', notes: blocked ? `${state.country}: blocked jurisdiction` : `${state.country} routes to the document route (no register link: the client supplies the documents)`, payload: { country: state.country, route: 'document', blocked } });
    if (blocked) { state.stopped = true; messages.push({ author_type: 'bank', kind: 'message', block_key: key, text: fillPlaceholders(MESSAGES.blockedJurisdiction, { country: state.country }) }); }
    return null;
  }

  if (step.kind === 'block' && b?.widget === 'registry_search') {
    state.reg = { stage: 'extract', ...(state.reg || {}) };
    const rd = routeDoc(b);
    if (step.sub === 'extract' || step.sub === 'articles') {
      const isExtract = step.sub === 'extract';
      state.reg.intro_done = true;
      uploadEffects(state, key, step, value, isExtract ? labelFor(snapshot, key, 'doc_extract') : labelFor(snapshot, key, 'doc_articles'), events, extra);
      if (state.failed_checks.length) {
        const n = state.reg[`${step.sub}_retries`] || 0;
        if (n < MAX_RE_REQUESTS) {
          state.reg[`${step.sub}_retries`] = n + 1;
          events.push({ event: 'rule', notes: 'Document check failed: re-request issued', payload: { block: key, step: step.sub, failed: state.failed_checks } });
          messages.push({ author_type: 'bank', kind: 'message', block_key: key, text: rd.steps?.[0]?.on_fail || '', tag: MESSAGES.documentTag });
          return done(displayOf('upload', value), { reask: true });
        }
        events.push({ event: 'rule', notes: `${key}: check still not met after ${n} new upload(s); kept for manual review`, payload: { block: key, step: step.sub } });
      }
      put(isExtract ? 'doc_extract' : 'doc_articles', fileValue(value), value.name, 'doc', { status: evidenceStatus(value.checks || []) });
      if (isExtract) {
        const r = value.read || {};
        const fields = { legal_name: r.legal_name, reg_no: r.registration_number, legal_form: r.legal_form, co_status: r.status, co_address: r.registered_address, co_activity: r.activity, reg_date: r.registration_date };
        for (const [k, x] of Object.entries(fields)) if (x) put(k, x, String(x), 'doc');
        state.reg.officers = asList(r.officers).filter((o) => o?.name);
        if (r.legal_form) state.legal_form_kind = legalFormKind(r.legal_form, extra.legalFormKeywords) || state.legal_form_kind;
        events.push({ event: 'ai.document.read', notes: r.legal_name ? 'Extract read by AI: name, number, legal form, address, activity, officers. Client confirms; an analyst checks against the original' : 'The extract could not be read automatically; the client enters the details', payload: { block: key, fields: Object.keys(fields).filter((k) => fields[k]), officers: state.reg.officers.length } });
        state.reg.stage = r.legal_name ? 'confirm' : 'correct';
        return done(displayOf('upload', value), { reask: true });
      }
      state.reg.stage = 'done';
      return done(displayOf('upload', value));
    }
    if (step.sub === 'confirm') {
      const ok = value === step.options?.[0];
      state.reg.stage = ok ? 'articles' : 'correct';
      return done(value, { reask: true });
    }
    if (step.sub === 'correct') {
      for (const k of ORG_PEOPLE_FIELDS) put(k, String(value[k]).trim(), String(value[k]).trim(), 'rep');
      state.legal_form_kind = legalFormKind(value.legal_form, extra.legalFormKeywords) || state.legal_form_kind;
      state.reg.stage = 'articles';
      return done(displayOf('form', value), { reask: true });
    }
  }

  if (step.kind === 'block' && b?.widget === 'people_list') {
    const list = asList(value).filter((p) => String(p?.name || '').trim()).map((p) => ({ name: String(p.name).trim(), role: p.role || 'Director', authority: p.authority || '', source: p.source || 'rep' }));
    const allProposed = list.every((p) => p.source !== 'rep');
    put(b.datapoints?.[0]?.key || key, list, list.map((p) => `${p.name}${p.role ? ` (${p.role})` : ''}`).join(', '), allProposed ? (list[0]?.source || 'doc') : 'rep');
    return done(displayOf('people_list', list.map((p) => ({ name: p.name }))));
  }

  if (step.kind === 'block' && b?.widget === 'owners_builder') {
    const list = ownersOf(value);
    put('owners', list, list.map((o) => `${o.name} ${o.pct}%`).join(', '), 'rep');
    queueCompanies(state, list, []);
    return done(displayOf('owners_builder', list));
  }

  if (step.kind === 'block' && key === 'ubo') {
    const tree = orgTree(state, v.uboThreshold);
    state.calculations = { ...(state.calculations || {}), 'no owner reaches threshold': tree.ubos.length === 0 };
    const dirs = asList(state.datapoints.directors?.value).map((x) => x.name);
    const valueUbo = { ubos: tree.ubos, shares: tree.shares, threshold: v.uboThreshold, ...(tree.ubos.length ? {} : { directors_as_ubo: dirs }) };
    put('ubos', valueUbo, tree.ubos.length ? tree.ubos.map((n) => `${n} (${tree.shares[n]}%)`).join(', ') : `${dirs.join(', ')} (senior managing officials)`, 'calc');
    state.answers = { ...(state.answers || {}), [key]: value };
    for (const f of triggeredFollowUps(snapshot, state, key)) {
      state.fired.push(`${key}:${f.id}`);
      if (f.action === 'rule') { events.push({ event: 'rule', notes: `No owner reaches ${v.uboThreshold}%: the directors are recorded as UBO (senior managing officials)`, payload: { block: key, follow_up: f.id, directors: dirs } }); continue; }
      state.queue.push({ block: key, fu: f.id });
    }
    return done(value);
  }

  // queued ORG entries
  if (step.kind === 'follow_up' && step.fu_id === 'company_reg') {
    putDatapoint(state, { key: `chain_${slug(step.company)}`, label: fillPlaceholders(labelFor(snapshot, 'owners', 'chain_{slug}', 'Owners of {name}'), { name: step.company }), value: { company: step.company, registration: String(value).trim(), owners: state.datapoints[`chain_${slug(step.company)}`]?.value?.owners || [] }, display: String(value).trim(), source: 'rep', block_key: key }, now);
    changed.push(`chain_${slug(step.company)}`);
    state.queue = state.queue.slice(1);
    return done(String(value).trim());
  }
  if (step.kind === 'follow_up' && step.fu_id === 'company_owners') {
    const list = ownersOf(value);
    const k = `chain_${slug(step.company)}`;
    const prev = state.datapoints[k]?.value || {};
    putDatapoint(state, { key: k, label: fillPlaceholders(labelFor(snapshot, 'owners', 'chain_{slug}', 'Owners of {name}'), { name: step.company }), value: { company: step.company, registration: prev.registration || '', owners: list }, display: list.map((o) => `${o.name} ${o.pct}%`).join(', '), source: 'rep', block_key: key }, now);
    changed.push(k);
    state.queue = state.queue.slice(1);
    queueCompanies(state, list, [step.company]);
    return done(displayOf('owners_builder', list));
  }
  if (step.kind === 'follow_up' && step.widget === 'people_list') {
    const list = asList(value).filter((p) => String(p?.name || '').trim()).map((p) => ({ name: String(p.name).trim(), authority: p.authority || '', note: p.note || '' }));
    put(step.datapoint_key || 'authreps', list, displayOf('people_list', list), 'rep');
    state.queue = state.queue.slice(1);
    return done(displayOf('people_list', list));
  }
  if (step.kind === 'follow_up' && step.person) {
    uploadEffects(state, key, step, value, step.label || step.datapoint_key, events, extra);
    put(step.datapoint_key, fileValue(value), value?.deferred ? MESSAGES.clientDeferred : value.name, 'doc', { label: step.label, status: value?.deferred ? 'deferred' : evidenceStatus(value.checks || []) });
    state.queue = state.queue.slice(1);
    return done(displayOf('upload', value));
  }
  return null;
}

function ownersOf(value) {
  return asList(value).filter((o) => String(o?.name || '').trim()).map((o) => ({ type: o.type === 'company' ? 'company' : 'person', name: String(o.name).trim(), pct: Math.round(Number(o.pct) * 10) / 10 }));
}
/** For every company owner: its registration, then its own owners (once per company; cycle protection). */
function queueCompanies(state, list, path) {
  const seen = new Set([...Object.values(state.datapoints).filter((d) => d.value?.company).map((d) => normName(d.value.company)), normName(state.datapoints.legal_name?.display), ...path.map(normName)]);
  const add = [];
  for (const o of list.filter((x) => x.type === 'company')) {
    if (seen.has(normName(o.name))) continue;
    seen.add(normName(o.name));
    add.push({ block: 'owners', kind: 'company_reg', company: o.name }, { block: 'owners', kind: 'company_owners', company: o.name });
  }
  state.queue.unshift(...add);
}

