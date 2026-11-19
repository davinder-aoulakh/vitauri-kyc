// outreachPortal — the public endpoint of the guided conversation outreach. The client's browser calls only this function
// (never entities). Access is the link token alone: it is hashed and matched against OutreachRequest.token_hash.
// It does not check the feature flag, so a link that was sent keeps working when the flag is switched off later.
// The server runs the conversation (base44/shared/outreachEngine.js); the browser only renders the step it gets back.
// Body: { token, action, ... }
//   open                                          -> view model (no case data): branding, greeting, deadline, sections, progress,
//                                                    open requests, thread, current step. The first open writes the intro messages.
//   start                                         -> the start chip: asks the first block
//   answer { client_answer_id, step_id, value }   -> applies an answer; the same client_answer_id twice returns the stored result;
//                                                    an answer for a step that is no longer current is refused (409)
//   edit { client_answer_id, datapoint_key, value } -> a change in the review (source becomes "Declared by client")
//   why_opened { block_key }                      -> logs client.why_opened
//   idv_start { portal_origin }                   -> the ID step: reuses an open Didit session or starts one (createDiditSession,
//                                                    server to server, within settings.idvMaxAttempts) and returns its address
//   idv_status                                    -> pulls the Didit result when the webhook is late (getDiditSessionResult) and
//                                                    applies a stored decision: approved / in review continue, declined re-offers
//   request_new_link                              -> on an expired link: notifies the assigned analyst (once)
// The ID&V step uses the real Didit session of the carrier's 'idv' item (phase 4). Test stand-in until phase 5: an upload sends
// only its name; it is marked test_stub and the conversation gets pending_step.test_data = true.
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.52';
import { asList, errorResponse, httpError } from '../../shared/tmAuth.js';
import { looksLikeToken, hashToken, linkState, createAttemptLimiter } from '../../shared/outreachToken.js';
import { fillPlaceholders, sectionsView } from '../../shared/outreachSnapshot.js';
import { outreachAuditRow, writeOutreachAudit } from '../../shared/outreachAudit.js';
import { initialState, advance, applyAnswer, applyEdit, reviewRows, progress, submissionHash, referenceNumber, submissionMessages, sourceLabel } from '../../shared/outreachEngine.js';
import { MESSAGES } from '../../shared/outreachMessages.js';
import { idvFromItem, idvChecks, idvState } from '../../shared/outreachIdv.js';
import { withDiditCredentials } from '../../shared/diditCredentials.js';

// Failed link attempts per client IP and per hash prefix (in memory per function instance; tokens are 256-bit).
const limiter = createAttemptLimiter({ max: 20, windowMs: 15 * 60 * 1000 });
const NOT_FOUND = 'This link is not valid. Please use the link from your most recent email.';
const MAX_SIGNATURE_BYTES = 600 * 1024;

function clientIp(req) {
  const f = req.headers.get('x-forwarded-for') || '';
  return (f.split(',')[0] || req.headers.get('x-real-ip') || req.headers.get('cf-connecting-ip') || '').trim() || 'unknown';
}

function tenantView(tenant) {
  return {
    name: tenant?.name || '',
    logo_url: tenant?.branding_logo_url || null,
    brand_color: /^#[0-9a-fA-F]{6}$/.test(String(tenant?.branding_primary_color || '')) ? tenant.branding_primary_color : null,
    help_text: tenant?.portal_contact_info || null,
    welcome_text: tenant?.portal_welcome_body || null,
    white_label: !!tenant?.white_label_enabled,
  };
}

function messageView(m) {
  return { id: m.id, seq: m.seq, author_type: m.author_type, author_name: m.author_name || null, kind: m.kind, block_key: m.block_key || null, tag: m.tag || null, ai_assisted: !!m.ai_assisted, text: m.display_text || '', why: m.payload?.why || null, card: m.kind === 'status_card' ? (m.payload || null) : null, status: m.status || 'sent', created_at: m.created_date };
}

/** What the browser may see of a step (no conditions, no follow-up rules). */
function stepView(step) {
  if (!step) return null;
  const { id, block_key, kind, widget, text, why, tag, options, multi, none_option, facts, prefill, checks, allow_defer, rows, declaration } = step;
  return { id, block_key, kind, widget, text, why: why || null, tag: tag || null, options: options || [], multi: !!multi, none_option: none_option || null, facts: facts || null, prefill: prefill || null, checks: checks || null, allow_defer: !!allow_defer, rows: rows || null, declaration: declaration || null, ...(step.idv ? { idv: step.idv } : {}) };
}

function fmtDate(iso) { try { return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }); } catch { return ''; } }

export default async function (req) {
  try {
    const base44 = createClientFromRequest(req);
    const body = await req.json().catch(() => ({}));
    const E = base44.asServiceRole.entities;
    const ip = clientIp(req);
    const token = String(body.token || '');
    if (limiter.blocked(`ip:${ip}`)) throw httpError(429, 'Too many attempts. Please wait a few minutes and try again.');
    if (!looksLikeToken(token)) { limiter.fail(`ip:${ip}`); throw httpError(404, NOT_FOUND); }
    const hash = await hashToken(token);
    if (limiter.blocked(`pfx:${hash.slice(0, 8)}`)) throw httpError(429, 'Too many attempts. Please wait a few minutes and try again.');
    const request = asList(await E.OutreachRequest.filter({ token_hash: hash }, undefined, 1))[0];
    if (!request || request.engine !== 'conversation') { limiter.fail(`ip:${ip}`); limiter.fail(`pfx:${hash.slice(0, 8)}`); throw httpError(404, NOT_FOUND); }
    const conversation = request.conversation_id ? asList(await E.OutreachConversation.filter({ tenant_id: request.tenant_id, id: request.conversation_id }, undefined, 1))[0] : null;
    if (!conversation) throw httpError(404, NOT_FOUND);
    const tenantId = conversation.tenant_id;
    const tenant = asList(await E.Tenant.filter({ id: tenantId }, undefined, 1))[0] || null;
    const conv = { id: conversation.id, request_id: request.id, case_id: conversation.case_id, client_id: conversation.client_id, party_id: conversation.party_id };
    const clientActor = { type: 'Client', name: conversation.invited_name || 'Client' };
    const now = new Date();
    const nowIso = now.toISOString();
    const link = linkState(request, conversation, now);
    const action = body.action || 'open';
    const audit = (rows) => (rows.length ? E.AuditEvent.bulkCreate(rows).catch((e) => console.warn('outreach audit failed', e?.message)) : null);
    const toAudit = (events, actor = clientActor) => events.map((e) => outreachAuditRow({ tenantId, event: e.event, actor: e.event === 'block.asked' || e.event === 'block.skipped' || e.event === 'rule' || e.event === 'prefill' || e.event.startsWith('ai.') || e.event === 'doc.checked' ? { type: 'System' } : actor, conversation: conv, payload: e.payload || {}, notes: e.notes }));

    if (action === 'request_new_link') {
      if (link !== 'expired') throw httpError(409, 'This link is still valid.');
      if (!conversation.new_link_requested_at) {
        await E.OutreachConversation.update(conversation.id, { new_link_requested_at: nowIso });
        const kc = conversation.case_id ? asList(await E.KycCase.filter({ tenant_id: tenantId, id: conversation.case_id }, undefined, 1))[0] : null;
        if (kc?.assigned_analyst_id) {
          await E.Notification.create({
            tenant_id: tenantId, user_id: kc.assigned_analyst_id, type: 'outreach_response', is_read: false,
            title: 'A client asks for a new outreach link', body: `${conversation.invited_name || 'The client'} opened an expired guided conversation link and asks for a new one.`,
            link_case_id: kc.id, link_client_id: conversation.client_id, dedupe_key: `outreach_new_link:${conversation.id}`,
          }).catch((e) => console.warn('notification failed', e?.message));
        }
        await writeOutreachAudit(E, outreachAuditRow({ tenantId, event: 'link.new_requested', actor: clientActor, conversation: conv, payload: { ip }, notes: 'The client opened an expired link and asked for a new one.' }));
      }
      return Response.json({ ok: true, requested: true });
    }

    const base = { ok: true, state: link, tenant: tenantView(tenant), deadline: conversation.deadline || request.deadline || null };
    if (link === 'expired') {
      if (conversation.status !== 'Expired' && conversation.status !== 'Submitted') {
        await E.OutreachConversation.update(conversation.id, { status: 'Expired' });
        await E.OutreachRequest.update(request.id, { status: 'Expired' });
        await writeOutreachAudit(E, outreachAuditRow({ tenantId, event: 'request.expired', actor: { type: 'System' }, conversation: conv, notes: 'The link passed its deadline and grace period.' }));
      }
      return Response.json({ ...base, first_name: conversation.invited_first_name || '', new_link_requested: !!conversation.new_link_requested_at });
    }
    if (link === 'cancelled') return Response.json(base);

    const snap = { template_snapshot: conversation.template_snapshot, blocks_snapshot: conversation.blocks_snapshot };
    const template = conversation.template_snapshot || {};
    const settings = conversation.settings_snapshot || {};
    const ps = conversation.pending_step || {};
    let engine = ps.engine || initialState({ risk: conversation.risk_class || 'medium' });
    engine.risk = conversation.risk_class || engine.risk; // staff may change the risk class; rules read the current value
    let step = ps.step || null;
    let testData = !!ps.test_data;
    const vars = { tenant_name: tenant?.name || '', first_name: conversation.invited_first_name || '', invitation_email: conversation.invited_email || '' };

    let messages = asList(await E.OutreachThreadMessage.filter({ tenant_id: tenantId, conversation_id: conversation.id }, 'seq', 1000));
    let seq = messages.reduce((m, x) => Math.max(m, x.seq || 0), 0);
    const pendingMsgs = [];
    const addMsg = (m, extra = {}) => { seq += 1; pendingMsgs.push({ tenant_id: tenantId, conversation_id: conversation.id, seq, author_type: m.author_type, author_name: m.author_type === 'bank' ? (tenant?.name || '') : m.author_type === 'client' ? (conversation.invited_name || '') : '', kind: m.kind || 'message', block_key: m.block_key || undefined, tag: m.tag || undefined, display_text: m.text, status: 'sent', ...(m.why || m.payload ? { payload: { ...(m.payload || {}), ...(m.why ? { why: m.why } : {}) } } : {}), ...extra }); };
    const flushMsgs = async () => { if (pendingMsgs.length) { await E.OutreachThreadMessage.bulkCreate(pendingMsgs.splice(0)); } };

    // Datapoint rows mirror the engine's datapoints (one row per key, history kept on the row).
    const syncDatapoints = async (keys) => {
      if (!keys.length) return;
      const rows = asList(await E.OutreachDatapoint.filter({ tenant_id: tenantId, conversation_id: conversation.id }, undefined, 500));
      for (const k of [...new Set(keys)]) {
        const d = engine.datapoints[k];
        if (!d) continue;
        const data = { tenant_id: tenantId, conversation_id: conversation.id, case_id: conversation.case_id, party_id: conversation.party_id || undefined, key: k, label: d.label, value: { v: d.value }, display_value: d.display, source: d.source, block_key: d.block_key, status: d.status || (d.history?.length ? 'edited' : 'given'), history: d.history || [] };
        const row = rows.find((r) => r.key === k);
        if (row) await E.OutreachDatapoint.update(row.id, data); else await E.OutreachDatapoint.create(data);
      }
    };

    const persist = async (patch = {}) => {
      const p = progress(snap, engine, { submitted: !!patch.submitted_at });
      const data = {
        block_states: engine.block_states, pending_step: { engine, step, test_data: testData },
        current_block_key: step?.block_key || null, progress_steps: p.steps, progress_total: p.total, last_activity_at: nowIso, ...patch,
      };
      await E.OutreachConversation.update(conversation.id, data);
      Object.assign(conversation, data);
    };

    const view = () => {
      const p = progress(snap, engine, { submitted: link === 'submitted' || !!conversation.submitted_at });
      return {
        ...base, state: conversation.submitted_at ? 'submitted' : link,
        first_name: conversation.invited_first_name || '', client_type: conversation.client_type || 'NP', template_name: template.name || '',
        start_chip: template.start_chip || null, expected_minutes: template.expected_minutes || null,
        sections: sectionsView(snap, engine.block_states || {}, step?.block_key || null), progress: p,
        saved_at: conversation.last_activity_at || null, open_requests: [], thread: messages.map(messageView),
        started: !!step || p.steps > 0 || !!conversation.submitted_at, submitted: !!conversation.submitted_at, reference: conversation.reference || null,
        step: conversation.submitted_at ? null : stepView(step), last_seq: seq,
        phone_codes: settings.phoneCountryCodes || [], address_countries: settings.addressCountries || [],
      };
    };
    const reload = async () => { messages = asList(await E.OutreachThreadMessage.filter({ tenant_id: tenantId, conversation_id: conversation.id }, 'seq', 1000)); };

    // ── ID&V (Didit) ────────────────────────────────────────────────────────────────────────────────────────────
    // The carrier's 'idv' item is written by createDiditSession, getDiditSessionResult and diditWebhook (frozen files).
    // Sessions started in this conversation are counted in engine.idv_sessions (attempt limit from settings).
    const maxAttempts = Number(settings.idvMaxAttempts) || 3;
    const idvItemOf = (r) => (r?.items || []).find((i) => i.item_id === 'idv') || null;
    const reloadCarrier = async () => asList(await E.OutreachRequest.filter({ tenant_id: tenantId, id: request.id }, undefined, 1))[0] || request;
    const noteSession = (item) => {
      const sid = item?.didit_session_id;
      if (sid && !(engine.idv_sessions || []).includes(sid)) engine.idv_sessions = [...(engine.idv_sessions || []), sid];
    };
    let diditConfigured = null;
    const isDiditConfigured = async () => {
      if (diditConfigured === null) { try { diditConfigured = !!(await withDiditCredentials(base44, tenant))?.didit_api_key; } catch { diditConfigured = false; } }
      return diditConfigured;
    };
    /** What the idv widget needs: state, session address (only while open), the four checks, attempts left. */
    const idvView = async (item) => {
      const st = idvState(item, { attempts: (engine.idv_sessions || []).length, maxAttempts });
      const configured = await isDiditConfigured();
      return {
        state: st.state, can_start: configured && st.can_start, attempts_left: st.attempts_left, configured,
        session_url: st.state === 'open' ? st.session_url : null,
        checks: ['approved', 'in_review', 'declined'].includes(st.state) ? idvChecks(item) : null,
        message: !configured ? MESSAGES.idvNotConfigured : st.state === 'declined' ? (st.can_start ? MESSAGES.idvDeclined : MESSAGES.idvNoAttempts)
          : st.state === 'expired' ? (st.can_start ? MESSAGES.idvExpired : MESSAGES.idvNoAttempts) : null,
      };
    };
    const decorateIdvStep = async (item) => { if (step?.widget === 'idv') step = { ...step, idv: await idvView(item) }; };
    /**
     * Applies a stored Didit decision to the conversation once per session: approved or in review -> the four datapoints
     * (source idv) and the conversation continues; declined / expired -> a message (once), a new attempt when allowed.
     */
    const applyIdvDecision = async (carrier) => {
      if (step?.widget !== 'idv') return [];
      const item = idvItemOf(carrier);
      noteSession(item);
      const st = idvState(item, { attempts: (engine.idv_sessions || []).length, maxAttempts });
      const sid = item?.didit_session_id || null;
      const events = [];
      if ((st.state === 'approved' || st.state === 'in_review') && sid && engine.idv_applied_session !== sid) {
        const r = applyAnswer(snap, engine, step, { session_done: true }, { now: nowIso, idv: idvFromItem(item), idv_outcome: st.state });
        if (r.error) return [];
        engine = { ...r.state, idv_applied_session: sid };
        addMsg({ author_type: 'client', kind: 'answer', block_key: step.block_key, text: r.clientText }, { client_answer_id: `idv-${sid}`.slice(0, 80), payload: { step_id: step.id, value: { session_done: true } } });
        r.messages.forEach((m) => addMsg(m));
        await syncDatapoints(r.datapoints);
        events.push({ event: 'idv.result', notes: `Didit ID check ${st.state === 'approved' ? 'approved' : 'in review'}`, payload: { session_id: sid, outcome: st.state, checks: idvChecks(item) } });
        events.push(...r.events, ...(await moveOn()));
        return events;
      }
      if ((st.state === 'declined' || st.state === 'expired') && sid && engine.idv_reported_session !== sid) {
        engine.idv_reported_session = sid;
        addMsg({ author_type: 'bank', kind: 'message', block_key: step.block_key, text: st.can_start ? (st.state === 'expired' ? MESSAGES.idvExpired : MESSAGES.idvDeclined) : MESSAGES.idvNoAttempts });
        events.push({ event: 'idv.result', notes: `Didit ID check ${st.state}${st.can_start ? `; ${st.attempts_left} attempt(s) left` : '; no attempts left'}`, payload: { session_id: sid, outcome: st.state, attempts_left: st.attempts_left, reason: st.reason || null } });
        if (!st.can_start) {
          const kc = conversation.case_id ? asList(await E.KycCase.filter({ tenant_id: tenantId, id: conversation.case_id }, undefined, 1))[0] : null;
          if (kc?.assigned_analyst_id) {
            await E.Notification.create({
              tenant_id: tenantId, user_id: kc.assigned_analyst_id, type: 'outreach_response', is_read: false,
              title: 'Identity check did not pass', body: `${conversation.invited_name || 'The client'} used all identity check attempts in the guided conversation.`,
              link_case_id: kc.id, link_client_id: conversation.client_id, dedupe_key: `outreach_idv_attempts:${conversation.id}`,
            }).catch((e) => console.warn('notification failed', e?.message));
          }
        }
        await persist();
      }
      return events;
    };

    // Moves on to the next step; at the end, submits.
    const moveOn = async () => {
      const a = advance(snap, engine, { ...vars, now: nowIso });
      engine = a.state;
      a.messages.forEach((m) => addMsg(m));
      const events = [...a.events];
      if (a.done) {
        step = null;
        const sha = await submissionHash(engine);
        const reference = referenceNumber(settings.referencePrefix || 'REF', now);
        const responseTime = conversation.client_type === 'ORG' ? settings.responseTimeTexts?.ORG : settings.responseTimeTexts?.NP;
        submissionMessages({ first_name: vars.first_name, response_time: responseTime || '', reference }).forEach((m) => addMsg(m));
        events.push({ event: 'case.submitted', notes: `Client declaration signed; answers frozen as version 1 (sha256:${sha.slice(0, 8)}…)`, payload: { sha256: sha, reference, test_data: testData } });
        await persist({ status: 'Submitted', submitted_at: nowIso, submission_hash: sha, reference });
        await E.OutreachRequest.update(request.id, { status: 'Complete' });
      } else {
        step = a.step;
        await persist(conversation.status === 'Opened' || conversation.status === 'Sent' ? { status: 'In_Progress' } : {});
        if (['Opened', 'Sent'].includes(request.status)) await E.OutreachRequest.update(request.id, { status: 'In_Progress' });
      }
      return events;
    };

    if (action === 'open') {
      if (!conversation.first_opened_at) {
        const patch = { first_opened_at: nowIso, last_activity_at: nowIso, ...(conversation.status === 'Sent' ? { status: 'Opened' } : {}) };
        await E.OutreachConversation.update(conversation.id, patch);
        Object.assign(conversation, patch);
        if (['Sent', 'Draft', 'Viewed'].includes(request.status)) await E.OutreachRequest.update(request.id, { status: 'Opened' });
        await writeOutreachAudit(E, outreachAuditRow({ tenantId, event: 'client.opened', actor: clientActor, conversation: conv, payload: { ip, user_agent: String(req.headers.get('user-agent') || '').slice(0, 300) }, notes: 'The client opened the guided conversation for the first time.' }));
      }
      if (step?.widget === 'idv' && !conversation.submitted_at) {
        // Resume around the Didit check (17 Nov): a stored decision is applied at once; an open session is reused.
        const carrier = await reloadCarrier();
        const events = await applyIdvDecision(carrier);
        if (events.length) { await flushMsgs(); await audit(toAudit(events)); await reload(); }
        await decorateIdvStep(idvItemOf(await reloadCarrier()));
      }
      if (!messages.length) {
        const deadlineDate = conversation.deadline ? fmtDate(conversation.deadline) : '';
        const client = asList(await E.Client.filter({ tenant_id: tenantId, id: conversation.client_id }, undefined, 1))[0] || {};
        const introVars = { ...vars, deadline_date: deadlineDate, company: client.client_type === 'ORG' ? client.full_name : '', role_text: '' };
        (template.intro_messages || []).map((t) => fillPlaceholders(t, introVars)).filter(Boolean).forEach((text) => addMsg({ author_type: 'bank', kind: 'message', text }));
        await flushMsgs();
        await reload();
      }
      return Response.json(view());
    }

    if (action === 'why_opened') {
      const key = String(body.block_key || '').slice(0, 60);
      if (!snap.blocks_snapshot?.[key]) throw httpError(400, 'Unknown question');
      await writeOutreachAudit(E, outreachAuditRow({ tenantId, event: 'client.why_opened', actor: clientActor, conversation: conv, payload: { block: key }, notes: `"Why do we ask this?" opened on ${key}` }));
      return Response.json({ ok: true });
    }

    if (link === 'submitted' || conversation.submitted_at) throw httpError(409, 'This conversation has been submitted.');

    if (action === 'idv_start' || action === 'idv_status') {
      if (step?.widget !== 'idv') return Response.json(view());
      let carrier = await reloadCarrier();
      let item = idvItemOf(carrier);
      noteSession(item);
      if (action === 'idv_status' && item?.didit_session_id && !['Pass', 'Fail', 'Expired'].includes(item.idv_status)) {
        // The webhook may be late: pull the decision once (the frozen function stores it on the item).
        try { await base44.asServiceRole.functions.invoke('getDiditSessionResult', { outreach_id: request.id, item_id: 'idv', access_token: token }); } catch (e) { console.warn('idv pull failed', e?.message); }
        carrier = await reloadCarrier();
        item = idvItemOf(carrier);
      }
      const events = await applyIdvDecision(carrier);
      if (events.length) {
        await flushMsgs(); await audit(toAudit(events)); await reload();
        await decorateIdvStep(idvItemOf(await reloadCarrier()));
        return Response.json(view());
      }
      if (action === 'idv_start') {
        const st = idvState(item, { attempts: (engine.idv_sessions || []).length, maxAttempts });
        if (st.state === 'open' || st.state === 'approved' || st.state === 'in_review') { await decorateIdvStep(item); return Response.json(view()); }
        if (!(await isDiditConfigured())) throw httpError(422, MESSAGES.idvNotConfigured);
        if (!st.can_start) throw httpError(422, MESSAGES.idvNoAttempts);
        const origin = String(req.headers.get('origin') || body.portal_origin || '').replace(/\/+$/, '');
        if (!/^https?:\/\/[^/\s]+$/.test(origin)) throw httpError(400, 'portal_origin is required');
        const res = await base44.asServiceRole.functions.invoke('createDiditSession', {
          outreach_id: request.id, item_id: 'idv', access_token: token, portal_url: `${origin}/o/${token}`, language: 'en',
          ...(conversation.invited_email ? { client_email: conversation.invited_email } : {}),
        }).catch((e) => ({ data: { error: e?.response?.status === 423 ? MESSAGES.idvUnavailable : (e?.response?.data?.error || e?.message) } }));
        if (res?.data?.error || !res?.data?.session_url) {
          await writeOutreachAudit(E, outreachAuditRow({ tenantId, event: 'adapter.error', actor: { type: 'System' }, conversation: conv, payload: { adapter: 'didit_idv', error: String(res?.data?.error || 'no session').slice(0, 200) }, notes: 'Didit session could not be started' }));
          throw httpError(502, /temporarily/.test(String(res?.data?.error)) ? MESSAGES.idvUnavailable : MESSAGES.idvNotConfigured);
        }
        carrier = await reloadCarrier();
        item = idvItemOf(carrier);
        noteSession(item);
        await persist();
        await writeOutreachAudit(E, outreachAuditRow({ tenantId, event: 'idv.session_started', actor: clientActor, conversation: conv, payload: { session_id: item?.didit_session_id || null, attempt: (engine.idv_sessions || []).length, max: maxAttempts }, notes: `Didit ID check started (attempt ${(engine.idv_sessions || []).length} of ${maxAttempts})` }));
      } else {
        await persist();
      }
      await decorateIdvStep(item);
      return Response.json(view());
    }

    if (action === 'start') {
      if (step) return Response.json(view()); // already started (second tab, retry)
      if (template.start_chip) addMsg({ author_type: 'client', kind: 'answer', text: template.start_chip });
      const events = await moveOn();
      await flushMsgs();
      await audit(toAudit(events));
      await reload();
      return Response.json(view());
    }

    const answerId = String(body.client_answer_id || '').slice(0, 80);
    if (!/^[A-Za-z0-9_-]{8,80}$/.test(answerId)) throw httpError(400, 'client_answer_id is required');
    const dup = messages.find((m) => m.client_answer_id === answerId);
    if (dup) return Response.json({ ...view(), duplicate: true });

    if (action === 'answer') {
      if (!step || body.step_id !== step.id) throw httpError(409, MESSAGES.notCurrent);
      let value = body.value;
      const extra = { now: nowIso, invitation_email: vars.invitation_email };
      if (step.widget === 'idv') {
        // Only "Not now" is a client answer here; the Didit result arrives through idv_status / open.
        if (value?.declined !== true) throw httpError(409, MESSAGES.notCurrent);
        value = { declined: true };
      } else if (step.widget === 'upload') {
        // Test stand-in until real uploads and checks (phase 5): only name, size and type are kept; no file is stored.
        value = value?.deferred ? { deferred: true } : { name: String(value?.name || '').slice(0, 200), size: Number(value?.size) || 0, mime: String(value?.mime || '').slice(0, 100), test_stub: true };
        if (!value.deferred) testData = true;
      } else if (step.widget === 'sign') {
        const sig = String(value?.signature || '');
        if (!/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(sig) || sig.length > MAX_SIGNATURE_BYTES * 1.4) throw httpError(400, MESSAGES.signIncomplete);
        value = { terms: value?.terms === true, typed_name: String(value?.typed_name || '').slice(0, 200), signature: sig };
      }
      const r = applyAnswer(snap, engine, step, value, extra);
      if (r.error) {
        if (step.widget === 'sign') await writeOutreachAudit(E, outreachAuditRow({ tenantId, event: 'rule', actor: { type: 'System' }, conversation: conv, payload: { block: step.block_key, error: r.error }, notes: `Signing refused: ${r.error}` }));
        return Response.json({ ...view(), error: r.error }, { status: 422 });
      }
      engine = r.state;
      if (step.widget === 'sign') {
        const bytes = Uint8Array.from(atob(value.signature.split(',')[1]), (c) => c.charCodeAt(0));
        let fileUri = null;
        try { fileUri = (await base44.asServiceRole.integrations.Core.UploadPrivateFile({ file: new File([bytes], `signature-${conversation.id}.png`, { type: 'image/png' }) }))?.file_uri || null; } catch (e) { console.warn('signature upload failed', e?.message); }
        await E.OutreachConversation.update(conversation.id, { signature: { file_uri: fileUri, typed_name: value.typed_name, signed_at: nowIso, ip, user_agent: String(req.headers.get('user-agent') || '').slice(0, 300) } });
      }
      addMsg({ author_type: 'client', kind: 'answer', block_key: step.block_key, text: r.clientText }, { client_answer_id: answerId, payload: { step_id: step.id, value: step.widget === 'sign' ? { typed_name: value.typed_name } : value } });
      r.messages.forEach((m) => addMsg(m));
      await syncDatapoints(r.datapoints);
      const events = [...r.events, ...(await moveOn())];
      await flushMsgs();
      await audit(toAudit(events));
      await reload();
      return Response.json(view());
    }

    if (action === 'edit') {
      if (!step || step.widget !== 'review') throw httpError(409, MESSAGES.notCurrent);
      const key = String(body.datapoint_key || '');
      const r = applyEdit(snap, engine, key, body.value, { now: nowIso });
      if (r.error) return Response.json({ ...view(), error: r.error }, { status: 422 });
      engine = r.state;
      await syncDatapoints([key]);
      const events = [...r.events];
      if (r.queued) {
        // a newly triggered follow-up is asked first; the review is shown again afterwards
        engine.block_states.review = { ...(engine.block_states.review || {}), state: 'not_asked' };
        events.push(...(await moveOn()));
      } else {
        step = { ...step, rows: reviewRows(snap, engine) };
        await persist();
      }
      // the edit itself is a client action: an id-stamped system line keeps retries idempotent
      addMsg({ author_type: 'system', kind: 'system_line', text: `Changed: ${engine.datapoints[key].label} (${sourceLabel('client')})` }, { client_answer_id: answerId });
      await flushMsgs();
      await audit(toAudit(events));
      await reload();
      return Response.json(view());
    }

    throw httpError(400, 'Unknown action');
  } catch (error) {
    if (!error?.status || error.status >= 500) console.error('outreachPortal error:', error?.message);
    return errorResponse(error);
  }
}
