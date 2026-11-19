// manageOutreachConversation — staff actions on running guided conversations (roles outreachConversationWork; flag on).
// Tenant from the signed-in user (Vitauri Ops: body.tenant_id).
//   list_pending { case_id }                                  -> AI follow-ups held for approval and the case's uploaded evidence
//   approve { conversation_id, text?, use_default? }          -> posts the held follow-up, tagged "checked by {name}" (spec 6.2)
//   evidence_url { evidence_id }                              -> 5-minute signed URL of an uploaded file
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.52';
import { asList, errorResponse, httpError } from '../../shared/tmAuth.js';
import { conversationOn } from '../../shared/outreachSettings.js';
import { OUTREACH_WORK_ROLES, OPS_ROLE } from '../../shared/outreachAuth.js';
import { approvePhrasing, advance, progress } from '../../shared/outreachEngine.js';
import { validatePhrasing } from '../../shared/outreachAiFollowup.js';
import { fillPlaceholders } from '../../shared/outreachSnapshot.js';
import { outreachAuditRow } from '../../shared/outreachAudit.js';

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
      return Response.json({ ok: true, pending, evidence: evidence.map((e) => ({ id: e.id, conversation_id: e.conversation_id, block_key: e.block_key, name: e.name, size: e.size, status: e.status, checks: e.checks || [], uploaded_at: e.uploaded_at, document_id: e.document_id || null })) });
    }

    if (action === 'evidence_url') {
      const ev = asList(await E.OutreachEvidence.filter({ tenant_id: tenantId, id: String(body.evidence_id || '') }, undefined, 1))[0];
      if (!ev?.file_uri) throw httpError(404, 'File not found');
      const signed = await base44.asServiceRole.integrations.Core.CreateFileSignedUrl({ file_uri: ev.file_uri, expires_in: 300 });
      return Response.json({ ok: true, url: signed?.signed_url || null });
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
      engine = approvePhrasing(engine, { text, ai, approver: actorName });
      const snap = { template_snapshot: c.template_snapshot, blocks_snapshot: c.blocks_snapshot };
      const a = advance(snap, engine, { ...vars, now: new Date().toISOString() });
      engine = a.state;
      const msgs = asList(await E.OutreachThreadMessage.filter({ tenant_id: tenantId, conversation_id: c.id }, 'seq', 1000));
      let seq = msgs.reduce((m, x) => Math.max(m, x.seq || 0), 0);
      const rows = a.messages.map((m) => ({
        tenant_id: tenantId, conversation_id: c.id, seq: ++seq, author_type: 'bank', author_name: tenant.name || '', kind: m.kind || 'message', block_key: m.block_key || undefined,
        tag: m.tag || undefined, ...(m.ai_assisted ? { ai_assisted: true } : {}), display_text: m.text, status: 'sent',
      }));
      if (rows.length) await E.OutreachThreadMessage.bulkCreate(rows);
      const p = progress(snap, engine, {});
      await E.OutreachConversation.update(c.id, { pending_step: { ...(c.pending_step || {}), engine, step: a.step }, block_states: engine.block_states, current_block_key: a.step?.block_key || null, progress_steps: p.steps, progress_total: p.total });
      const open = asList(await E.OutreachOpenRequest.filter({ tenant_id: tenantId, conversation_id: c.id, kind: 'ai_approval', status: 'open' }, undefined, 20));
      for (const o of open.filter((o) => o.block_key === q.block)) await E.OutreachOpenRequest.update(o.id, { status: 'answered', answered_at: new Date().toISOString() });
      const conv = { id: c.id, request_id: c.request_id || undefined, case_id: c.case_id, client_id: c.client_id, party_id: c.party_id };
      const audit = [
        outreachAuditRow({ tenantId, event: 'ai.followup.approved', actor: { type: 'User', id: user.id, name: actorName }, conversation: conv, payload: { block: q.block, follow_up: q.fu, how, ai, text }, notes: `Follow-up on ${q.block} ${how} by ${actorName}` }),
        ...a.events.map((e) => outreachAuditRow({ tenantId, event: e.event, actor: { type: 'System' }, conversation: conv, payload: e.payload || {}, notes: e.notes })),
      ];
      await E.AuditEvent.bulkCreate(audit).catch((e) => console.warn('audit failed', e?.message));
      return Response.json({ ok: true, text, how });
    }

    throw httpError(400, 'Unknown action');
  } catch (error) {
    if (!error?.status || error.status >= 500) console.error('manageOutreachConversation error:', error?.message);
    return errorResponse(error);
  }
}
