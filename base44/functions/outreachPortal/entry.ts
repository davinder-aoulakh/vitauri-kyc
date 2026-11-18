// outreachPortal — the public endpoint of the guided conversation outreach. The client's browser calls only this function
// (never entities). Access is the link token alone: it is hashed and matched against OutreachRequest.token_hash.
// It does not check the feature flag, so a link that was sent keeps working when the flag is switched off later.
// Body: { token, action }
//   open               -> the view model of the conversation (no case data): tenant branding, greeting, deadline, sections,
//                         progress, open requests and the thread. The first open writes the intro messages and logs client.opened.
//   request_new_link   -> on an expired link: notifies the assigned analyst (once) and logs link.new_requested.
// The server decides what is asked (from phase 3); the browser only renders.
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.52';
import { asList, errorResponse, httpError } from '../../shared/tmAuth.js';
import { looksLikeToken, hashToken, linkState, createAttemptLimiter } from '../../shared/outreachToken.js';
import { fillPlaceholders, sectionsView, minutesLeft } from '../../shared/outreachSnapshot.js';
import { outreachAuditRow, writeOutreachAudit } from '../../shared/outreachAudit.js';

// Failed link attempts per client IP and per hash prefix (in memory per function instance; tokens are 256-bit).
const limiter = createAttemptLimiter({ max: 20, windowMs: 15 * 60 * 1000 });
const NOT_FOUND = 'This link is not valid. Please use the link from your most recent email.';

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
  return { id: m.id, seq: m.seq, author_type: m.author_type, author_name: m.author_name || null, kind: m.kind, block_key: m.block_key || null, tag: m.tag || null, ai_assisted: !!m.ai_assisted, text: m.display_text || '', status: m.status || 'sent', created_at: m.created_date };
}

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
    const state = linkState(request, conversation, now);
    const action = body.action || 'open';

    if (action === 'request_new_link') {
      if (state !== 'expired') throw httpError(409, 'This link is still valid.');
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
    if (action !== 'open') throw httpError(400, 'Unknown action');

    const base = { ok: true, state, tenant: tenantView(tenant), deadline: conversation.deadline || request.deadline || null };
    if (state === 'expired') {
      if (conversation.status !== 'Expired' && conversation.status !== 'Submitted') {
        await E.OutreachConversation.update(conversation.id, { status: 'Expired' });
        await E.OutreachRequest.update(request.id, { status: 'Expired' });
        await writeOutreachAudit(E, outreachAuditRow({ tenantId, event: 'request.expired', actor: { type: 'System' }, conversation: conv, notes: 'The link passed its deadline and grace period.' }));
      }
      return Response.json({ ...base, first_name: conversation.invited_first_name || '', new_link_requested: !!conversation.new_link_requested_at });
    }
    if (state === 'cancelled') return Response.json(base);

    const snap = { template_snapshot: conversation.template_snapshot, blocks_snapshot: conversation.blocks_snapshot };
    const template = conversation.template_snapshot || {};
    let messages = asList(await E.OutreachThreadMessage.filter({ tenant_id: tenantId, conversation_id: conversation.id }, 'seq', 500));
    if (!conversation.first_opened_at) {
      const patch = { first_opened_at: nowIso, last_activity_at: nowIso, ...(conversation.status === 'Sent' ? { status: 'Opened' } : {}) };
      await E.OutreachConversation.update(conversation.id, patch);
      Object.assign(conversation, patch);
      if (['Sent', 'Draft', 'Viewed'].includes(request.status)) await E.OutreachRequest.update(request.id, { status: 'Opened' });
      await writeOutreachAudit(E, outreachAuditRow({ tenantId, event: 'client.opened', actor: clientActor, conversation: conv, payload: { ip, user_agent: String(req.headers.get('user-agent') || '').slice(0, 300) }, notes: 'The client opened the guided conversation for the first time.' }));
    }
    if (!messages.length) {
      const deadlineDate = conversation.deadline ? new Date(conversation.deadline).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }) : '';
      const client = asList(await E.Client.filter({ tenant_id: tenantId, id: conversation.client_id }, undefined, 1))[0] || {};
      const vars = { first_name: conversation.invited_first_name || '', tenant_name: tenant?.name || '', deadline_date: deadlineDate, company: client.client_type === 'ORG' ? client.full_name : '', role_text: '' };
      const rows = (template.intro_messages || []).map((t, i) => ({
        tenant_id: tenantId, conversation_id: conversation.id, seq: i + 1, author_type: 'bank', author_name: tenant?.name || '', kind: 'message', display_text: fillPlaceholders(t, vars), status: 'sent',
      })).filter((r) => r.display_text);
      if (rows.length) {
        await E.OutreachThreadMessage.bulkCreate(rows);
        messages = asList(await E.OutreachThreadMessage.filter({ tenant_id: tenantId, conversation_id: conversation.id }, 'seq', 500));
      }
    }
    const openRequests = asList(await E.OutreachOpenRequest.filter({ tenant_id: tenantId, conversation_id: conversation.id, status: 'open' }, undefined, 50))
      .map((o) => ({ id: o.id, title: o.title, from: o.from_name || null }));
    const total = conversation.progress_total || 0;
    const steps = conversation.progress_steps || 0;
    return Response.json({
      ...base,
      first_name: conversation.invited_first_name || '',
      client_type: conversation.client_type || 'NP',
      template_name: template.name || '',
      start_chip: template.start_chip || null,
      expected_minutes: template.expected_minutes || null,
      sections: sectionsView(snap, conversation.block_states || {}, conversation.current_block_key),
      progress: { steps, total, pct: total ? Math.min(100, Math.round((steps / total) * 100)) : 0, minutes_left: minutesLeft(total, steps) },
      saved_at: conversation.last_activity_at || null,
      open_requests: openRequests,
      thread: messages.map(messageView),
      started: !!conversation.current_block_key || steps > 0,
      submitted: state === 'submitted',
      reference: conversation.reference || null,
    });
  } catch (error) {
    if (!error?.status || error.status >= 500) console.error('outreachPortal error:', error?.message);
    return errorResponse(error);
  }
}
