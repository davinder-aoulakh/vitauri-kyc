// Guided conversation outreach, phase 9: server helpers shared by outreachPortal, manageOutreachConversation and
// outreachSweep. Thread messages, the held AI follow-up approval, the stored link and the conversation emails.
// Server only (service-role entities are passed in). Never returns the token.
import { asList } from './tmAuth.js';
import { approvePhrasing, advance, progress } from './outreachEngine.js';
import { outreachAuditRow } from './outreachAudit.js';
import { conversationEmail } from './outreachSecondRound.js';
import { assertNotLocked } from './tippingOff.js';

/** Appends thread messages after the highest seq. msgs use the engine shape { author_type, author_name, kind, text, tag, ... }. */
export async function appendMessages(E, { tenantId, conversationId, tenantName = '', msgs = [] }) {
  if (!msgs.length) return [];
  const last = asList(await E.OutreachThreadMessage.filter({ tenant_id: tenantId, conversation_id: conversationId }, '-seq', 1))[0];
  let seq = last?.seq || 0;
  const rows = msgs.map((m) => ({
    tenant_id: tenantId, conversation_id: conversationId, seq: ++seq, author_type: m.author_type || 'bank',
    author_name: m.author_name || (m.author_type === 'bank' || !m.author_type ? tenantName : undefined) || undefined,
    kind: m.kind || 'message', block_key: m.block_key || undefined, tag: m.tag || undefined,
    ...(m.ai_assisted ? { ai_assisted: true } : {}), ...(m.payload ? { payload: m.payload } : {}),
    ...(m.client_answer_id ? { client_answer_id: m.client_answer_id } : {}),
    display_text: m.text, status: 'sent',
  }));
  await E.OutreachThreadMessage.bulkCreate(rows);
  return rows;
}

/**
 * Posts a held AI follow-up (approved by staff, or the default text after the wait time): approvePhrasing → advance →
 * thread rows → conversation update → ai_approval open requests answered. Returns { audit: rows, step }.
 */
export async function postHeldFollowUp(E, { tenant, c, text, ai, approverName, vars, auditEvent, auditNotes, auditPayload, actor }) {
  const tenantId = c.tenant_id;
  let engine = c.pending_step?.engine;
  const q = engine?.queue?.[0];
  if (!q?.held) return null;
  engine = approvePhrasing(engine, { text, ai, approver: approverName || null });
  const snap = { template_snapshot: c.template_snapshot, blocks_snapshot: c.blocks_snapshot };
  const a = advance(snap, engine, { ...vars, now: new Date().toISOString() });
  engine = a.state;
  await appendMessages(E, { tenantId, conversationId: c.id, tenantName: tenant.name || '', msgs: a.messages.map((m) => ({ ...m, author_type: 'bank' })) });
  const p = progress(snap, engine, {});
  await E.OutreachConversation.update(c.id, { pending_step: { ...(c.pending_step || {}), engine, step: a.step, rev: Number(c.pending_step?.rev || 0) + 1 }, block_states: engine.block_states, current_block_key: a.step?.block_key || null, progress_steps: p.steps, progress_total: p.total });
  const open = asList(await E.OutreachOpenRequest.filter({ tenant_id: tenantId, conversation_id: c.id, kind: 'ai_approval', status: 'open' }, undefined, 20));
  for (const o of open.filter((o) => o.block_key === q.block)) await E.OutreachOpenRequest.update(o.id, { status: 'answered', answered_at: new Date().toISOString() });
  const conv = { id: c.id, request_id: c.request_id || undefined, case_id: c.case_id, client_id: c.client_id, party_id: c.party_id };
  const audit = [
    outreachAuditRow({ tenantId, event: auditEvent, actor, conversation: conv, payload: { block: q.block, follow_up: q.fu, ai, text, ...(auditPayload || {}) }, notes: auditNotes }),
    ...a.events.map((e) => outreachAuditRow({ tenantId, event: e.event, actor: { type: 'System' }, conversation: conv, payload: e.payload || {}, notes: e.notes })),
  ];
  await E.AuditEvent.bulkCreate(audit).catch((e) => console.warn('audit failed', e?.message));
  return { audit, step: a.step, q };
}

/** Stores the raw token server-only (decision 19 Nov) so later emails carry the same link. */
export async function storeLinkToken(E, { tenantId, conversationId, requestId, token, link }) {
  await E.OutreachLinkToken.create({ tenant_id: tenantId, conversation_id: conversationId, request_id: requestId, token, link }).catch((e) => console.warn('link store failed', e?.message));
}

/** The stored link of a conversation, or '' for conversations sent before phase 9. */
export async function linkOf(E, tenantId, conversationId) {
  const row = asList(await E.OutreachLinkToken.filter({ tenant_id: tenantId, conversation_id: conversationId }, '-created_date', 1).catch(() => []))[0];
  return row?.link || '';
}

/**
 * Sends a conversation email (new message / reminder) after the tipping-off check. Returns { emailed, error, locked }.
 * Body carries first name and company only.
 */
export async function sendConversationEmail(base44, { tenant, c, situation }) {
  const E = base44.asServiceRole.entities;
  if (!c.invited_email) return { emailed: false, error: 'no email address' };
  try { await assertNotLocked(base44, c.client_id, c.tenant_id); } catch (e) {
    if (e?.status === 423) return { emailed: false, locked: true, error: 'customer communications are locked' };
    throw e;
  }
  const [templates, link] = await Promise.all([
    E.EmailTemplate.filter({ tenant_id: c.tenant_id }, undefined, 100).then(asList).catch(() => []),
    linkOf(E, c.tenant_id, c.id),
  ]);
  const company = c.org_context?.company || c.pending_step?.engine?.datapoints?.legal_name?.display || '';
  const deadlineDate = c.deadline ? new Date(c.deadline).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }) : '';
  const mail = conversationEmail({ templates, situation, vars: { first_name: c.invited_first_name || '', company, tenant_name: tenant.name || '', link, deadline_date: deadlineDate } });
  try {
    await base44.asServiceRole.integrations.Core.SendEmail({
      from_name: tenant.email_from_name || tenant.name || 'Compliance Team',
      ...(tenant.email_from_address ? { from_email: tenant.email_from_address } : {}),
      to: c.invited_email, subject: mail.subject, body: mail.body,
    });
    return { emailed: true, with_link: !!link, from_template: mail.from_template };
  } catch (e) {
    return { emailed: false, error: String(e?.message || e).slice(0, 200) };
  }
}
