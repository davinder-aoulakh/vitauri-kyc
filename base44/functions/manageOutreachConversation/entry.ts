// manageOutreachConversation — staff actions on running guided conversations (roles outreachConversationWork; flag on).
// Tenant from the signed-in user (Vitauri Ops: body.tenant_id).
//   list_pending { case_id }                                  -> AI follow-ups held for approval and the case's uploaded evidence
//   approve { conversation_id, text?, use_default? }          -> posts the held follow-up, tagged "checked by {name}" (spec 6.2)
//   evidence_url { evidence_id }                              -> 5-minute signed URL of an uploaded file
//   release_invites { conversation_id, portal_origin }       -> Queued invitations -> Invited (child requests + emails) before the
//                                                               representative's ID check releases them (audited as manual)
//   ask { conversation_id, request_type: question|document, title, text } -> second round (spec 5.7): open request, system
//                                                               line + analyst message, "new message" email (tipping-off check)
//   reply { conversation_id, text }                           -> analyst message in the thread (+ new message email)
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.52';
import { asList, errorResponse, httpError } from '../../shared/tmAuth.js';
import { conversationOn } from '../../shared/outreachSettings.js';
import { OUTREACH_WORK_ROLES, OPS_ROLE } from '../../shared/outreachAuth.js';
import { validatePhrasing } from '../../shared/outreachAiFollowup.js';
import { fillPlaceholders } from '../../shared/outreachSnapshot.js';
import { outreachAuditRow, writeOutreachAudit } from '../../shared/outreachAudit.js';
import { inviteTransition } from '../../shared/outreachInvites.js';
import { createChildConversation } from '../../shared/outreachChildRequest.js';
import { assertNotLocked } from '../../shared/tippingOff.js';
import { postHeldFollowUp, appendMessages, sendConversationEmail } from '../../shared/outreachThread.js';
import { analystRequestMessages, analystTag, cleanMessage, SITUATIONS } from '../../shared/outreachSecondRound.js';

export default async function (req) {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me().catch(() => null);
    if (!user) throw httpError(401, 'Unauthorized');
    const role = user.app_role || user.data?.app_role;
    const isOps = role === OPS_ROLE;
    const body = await req.json().catch(() => ({}));
    const tenantId = isOps && body.tenant_id ? String(body.tenant_id) : (user.tenant_id || user.data?.tenant_id);
    if (!tenantId) throw httpError(403, 'No tenant associated with this user');
    if (!isOps && !OUTREACH_WORK_ROLES.includes(role)) throw httpError(403, 'Forbidden');
    const E = base44.asServiceRole.entities;
    const tenant = asList(await E.Tenant.filter({ id: tenantId }, undefined, 1))[0];
    if (!tenant) throw httpError(404, 'Tenant not found');
    if (!conversationOn(tenant)) throw httpError(403, 'Guided conversation outreach is not enabled for this tenant');
    const action = body.action || 'list_pending';
    const actorName = user.full_name || user.email || 'Analyst';

    const fuOf = (c, q) => (c.blocks_snapshot?.[q.block]?.follow_ups || []).find((f) => f.id === q.fu) || null;
    const varsOf = (c) => ({ tenant_name: tenant.name || '', first_name: c.invited_first_name || '', invitation_email: c.invited_email || '' });
    const answerText = (c, q) => {
      const eng = c.pending_step?.engine || {};
      const main = c.blocks_snapshot?.[q.block]?.datapoints?.[0]?.key;
      return eng.datapoints?.[main]?.display || (Array.isArray(eng.answers?.[q.block]) ? eng.answers[q.block].join(', ') : String(eng.answers?.[q.block] ?? ''));
    };

    if (action === 'list_pending') {
      const caseId = String(body.case_id || '');
      if (!caseId) throw httpError(400, 'case_id is required');
      const convs = asList(await E.OutreachConversation.filter({ tenant_id: tenantId, case_id: caseId }, '-created_date', 20));
      const pending = [];
      for (const c of convs) {
        const q = c.pending_step?.engine?.queue?.[0];
        if (!q?.held || c.submitted_at) continue;
        const f = fuOf(c, q);
        pending.push({
          conversation_id: c.id, invited_name: c.invited_name || '', block_key: q.block, block_label: c.blocks_snapshot?.[q.block]?.label || q.block,
          client_answer: answerText(c, q), proposal: q.proposal?.text || '', proposal_ai: !!q.proposal?.ai, default_text: fillPlaceholders(f?.question || '', varsOf(c)),
        });
      }
      const ids = convs.map((c) => c.id);
      const evidence = ids.length ? asList(await E.OutreachEvidence.filter({ tenant_id: tenantId, conversation_id: { $in: ids } }, '-created_date', 100)) : [];
      const invites = ids.length ? asList(await E.OutreachInvite.filter({ tenant_id: tenantId, conversation_id: { $in: ids } }, '-created_date', 100)) : [];
      const opens = ids.length ? asList(await E.OutreachOpenRequest.filter({ tenant_id: tenantId, conversation_id: { $in: ids }, kind: { $in: ['analyst_request', 'deferred_evidence'] } }, '-created_date', 100)) : [];
      const clientMsgs = [];
      for (const c of convs.filter((x) => x.submitted_at).slice(0, 5)) {
        const ms = asList(await E.OutreachThreadMessage.filter({ tenant_id: tenantId, conversation_id: c.id }, '-seq', 60));
        const sub = new Date(c.submitted_at).getTime();
        ms.filter((m) => ['client', 'analyst'].includes(m.author_type) && new Date(m.created_date || 0).getTime() >= sub).reverse()
          .forEach((m) => clientMsgs.push({ id: m.id, conversation_id: c.id, author_type: m.author_type, author_name: m.author_name || '', tag: m.tag || '', text: m.display_text || '', at: m.created_date }));
      }
      const openRequests = opens.map((o) => ({ id: o.id, conversation_id: o.conversation_id, kind: o.kind, request_type: o.request_type || (o.kind === 'deferred_evidence' ? 'document' : 'question'), title: o.title, text: o.text || '', from_name: o.from_name || '', status: o.status, answered_at: o.answered_at || null, answer_text: o.answer_text || '', answer_evidence_id: o.answer_evidence_id || null, created_at: o.created_date }));
      const conversations = convs.map((c) => ({ id: c.id, status: c.status, submitted: !!c.submitted_at, invited_name: c.invited_name || '', client_type: c.client_type }));
      return Response.json({ ok: true, conversations, open_requests: openRequests, messages: clientMsgs, pending, invites: invites.map((i) => ({ id: i.id, conversation_id: i.conversation_id, name: String(i.roles_text || '').split('|')[0], roles: String(i.roles_text || '').split('|')[1] || '', email: i.email, status: i.status, queued_at: i.queued_at, invited_at: i.invited_at, completed_at: i.completed_at })), evidence: evidence.map((e) => ({ id: e.id, conversation_id: e.conversation_id, block_key: e.block_key, name: e.name, size: e.size, status: e.status, checks: e.checks || [], uploaded_at: e.uploaded_at, document_id: e.document_id || null })) });
    }

    if (action === 'evidence_url') {
      const ev = asList(await E.OutreachEvidence.filter({ tenant_id: tenantId, id: String(body.evidence_id || '') }, undefined, 1))[0];
      if (!ev?.file_uri) throw httpError(404, 'File not found');
      const signed = await base44.asServiceRole.integrations.Core.CreateFileSignedUrl({ file_uri: ev.file_uri, expires_in: 300 });
      return Response.json({ ok: true, url: signed?.signed_url || null });
    }

    if (action === 'release_invites') {
      const c = asList(await E.OutreachConversation.filter({ tenant_id: tenantId, id: String(body.conversation_id || '') }, undefined, 1))[0];
      if (!c) throw httpError(404, 'Conversation not found');
      const request = asList(await E.OutreachRequest.filter({ tenant_id: tenantId, id: c.request_id }, undefined, 1))[0];
      const origin = String(body.portal_origin || req.headers.get('origin') || '').replace(/\/+$/, '');
      if (!/^https?:\/\/[^/\s]+$/.test(origin)) throw httpError(400, 'portal_origin is required');
      const queued = asList(await E.OutreachInvite.filter({ tenant_id: tenantId, conversation_id: c.id, status: 'Queued' }, undefined, 50));
      const done = [];
      for (const inv of queued) {
        if (!inviteTransition(inv.status, 'release')) continue;
        const [name, roles] = String(inv.roles_text || '').split('|');
        const roleText = String(roles || '').split(/\s*,\s*/).map((r) => ({ Director: 'Director', UBO: 'ultimate beneficial owner', 'Authorized Signatory': 'authorised representative' }[r])).filter(Boolean).join(' and ') || 'related party';
        const r = await createChildConversation({ base44, tenant, parent: { conversation: c, request }, party: { name, role_text: roleText, related_party_id: inv.party_id }, email: inv.email, origin, actor: { type: 'User', id: user.id, name: actorName } });
        if (r.ok) { await E.OutreachInvite.update(inv.id, { status: 'Invited', invited_at: new Date().toISOString(), child_request_id: r.child_request_id }); done.push(name); }
      }
      await writeOutreachAudit(E, outreachAuditRow({ tenantId, event: 'invitation.released', actor: { type: 'User', id: user.id, name: actorName }, conversation: { id: c.id, request_id: c.request_id, case_id: c.case_id, client_id: c.client_id }, payload: { released: done, manual: true }, notes: `Queued invitations released manually by ${actorName}: ${done.join(', ') || 'none'}` }));
      return Response.json({ ok: true, released: done });
    }

    if (action === 'approve') {
      const c = asList(await E.OutreachConversation.filter({ tenant_id: tenantId, id: String(body.conversation_id || '') }, undefined, 1))[0];
      if (!c) throw httpError(404, 'Conversation not found');
      let engine = c.pending_step?.engine;
      const q = engine?.queue?.[0];
      if (!q?.held || c.submitted_at) throw httpError(409, 'Nothing is waiting for approval in this conversation');
      const f = fuOf(c, q);
      const vars = varsOf(c);
      const defaultText = fillPlaceholders(f?.question || '', vars);
      let text = q.proposal?.text || defaultText;
      let ai = !!q.proposal?.ai;
      let how = 'approved';
      if (body.use_default) { text = defaultText; ai = false; how = 'replaced with the default text'; }
      else if (typeof body.text === 'string' && body.text.trim() && body.text.trim() !== text) {
        const v = validatePhrasing(body.text);
        if (!v.ok) throw httpError(400, `The question cannot be sent: ${v.reason}`);
        text = v.text; ai = false; how = 'edited and approved';
      }
      await postHeldFollowUp(E, {
        tenant, c, text, ai, approverName: actorName, vars, actor: { type: 'User', id: user.id, name: actorName },
        auditEvent: 'ai.followup.approved', auditPayload: { how }, auditNotes: `Follow-up on ${q.block} ${how} by ${actorName}`,
      });
      return Response.json({ ok: true, text, how });
    }

    if (action === 'ask' || action === 'reply') {
      const c = asList(await E.OutreachConversation.filter({ tenant_id: tenantId, id: String(body.conversation_id || '') }, undefined, 1))[0];
      if (!c) throw httpError(404, 'Conversation not found');
      if (['Cancelled', 'Expired'].includes(c.status)) throw httpError(409, 'This conversation is closed');
      const text = cleanMessage(body.text);
      const conv = { id: c.id, request_id: c.request_id || undefined, case_id: c.case_id, client_id: c.client_id, party_id: c.party_id };
      const actor = { type: 'User', id: user.id, name: actorName };
      // tipping-off: no new customer communication while the client is locked (423, nothing written)
      await assertNotLocked(base44, c.client_id, tenantId);
      let open = null;
      let msgs;
      if (action === 'ask') {
        const type = body.request_type === 'question' ? 'question' : 'document';
        const title = String(body.title || '').trim().slice(0, 140);
        if (!title) throw httpError(400, 'A short title is required');
        open = await E.OutreachOpenRequest.create({ tenant_id: tenantId, conversation_id: c.id, title, text, kind: 'analyst_request', request_type: type, status: 'open', from_name: actorName, from_user_id: user.id, from_role: role || '', assigned_user_id: user.id });
        msgs = analystRequestMessages({ name: actorName, role, text, request_type: type, open_request_id: open.id });
      } else {
        msgs = [{ author_type: 'analyst', author_name: actorName, kind: 'message', tag: analystTag(actorName, role), text }];
      }
      await appendMessages(E, { tenantId, conversationId: c.id, tenantName: tenant.name || '', msgs });
      await E.OutreachConversation.update(c.id, { last_activity_at: new Date().toISOString() });
      const mail = await sendConversationEmail(base44, { tenant, c, situation: SITUATIONS.NEW_MESSAGE });
      await writeOutreachAudit(E, outreachAuditRow({
        tenantId, event: action === 'ask' ? 'request.created' : 'analyst.message', actor, conversation: conv,
        payload: { open_request_id: open?.id, request_type: open?.request_type, title: open?.title, emailed: !!mail.emailed, email_error: mail.error || null, with_link: !!mail.with_link },
        notes: action === 'ask' ? `Analyst ${actorName} asked for ${open.title} (second round, same thread)` : `Analyst ${actorName} replied in the conversation`,
      }));
      return Response.json({ ok: true, open_request_id: open?.id || null, emailed: !!mail.emailed, email_error: mail.error || null });
    }

    throw httpError(400, 'Unknown action');
  } catch (error) {
    if (!error?.status || error.status >= 500) console.error('manageOutreachConversation error:', error?.message);
    return errorResponse(error);
  }
}
