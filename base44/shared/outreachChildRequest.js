// Guided conversation outreach: a related party's own conversation (template related_party_np) as a child of an ORG
// conversation (plan phase 7). Creates the carrier OutreachRequest (related_party_id, parent_request_id), the conversation
// (client_type RP, org_context { company, role_text }), the open request "Own checks: {name}" on the parent and sends the
// invitation email after the tipping-off check. Server only (service role entities passed in).
import { asList } from './tmAuth.js';
import { newToken, hashToken, linkDates } from './outreachToken.js';
import { buildSnapshot, initialProgressTotal, fillPlaceholders } from './outreachSnapshot.js';
import { inviteEmail } from './outreachEmail.js';
import { outreachAuditRow, writeOutreachAudit } from './outreachAudit.js';
import { assertNotLocked } from './tippingOff.js';
import { MESSAGES } from './outreachMessages.js';
import { storeLinkToken } from './outreachThread.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * party: { name, role_text, related_party_id }; parent: { conversation, request }; origin: https origin of the app.
 * Returns { ok, child_request_id, conversation_id, emailed } or { ok: false, error }.
 */
export async function createChildConversation({ base44, tenant, parent, party, email, origin, actor = { type: 'System' } }) {
  const E = base44.asServiceRole.entities;
  const tenantId = parent.conversation.tenant_id;
  const to = String(email || '').trim().toLowerCase();
  if (!EMAIL_RE.test(to)) return { ok: false, error: 'A valid email address is required' };
  try { await assertNotLocked(base44, parent.conversation.client_id, tenantId); } catch (e) { return { ok: false, error: e?.status === 423 ? 'Communication is temporarily unavailable' : String(e?.message || e) }; }
  const [templates, blocks, emailTemplates] = await Promise.all([
    E.OutreachFlowTemplate.filter({ tenant_id: tenantId, key: 'related_party_np' }, undefined, 50).then(asList),
    E.OutreachBlock.filter({ tenant_id: tenantId }, undefined, 2000).then(asList),
    E.EmailTemplate.filter({ tenant_id: tenantId }, undefined, 100).then(asList).catch(() => []),
  ]);
  const template = templates.filter((t) => t.status === 'published').sort((a, b) => (b.version || 1) - (a.version || 1))[0];
  if (!template) return { ok: false, error: 'There is no published related-party template. Publish one in Tenant Config.' };
  const settings = parent.conversation.settings_snapshot || {};
  let snap;
  try { snap = buildSnapshot({ template, blocks, settings, kvkMode: 'off' }); } catch (e) { return { ok: false, error: e.message }; }
  const now = new Date();
  const days = template.default_deadline_days || settings.defaultDeadlineDays || 14;
  const dates = linkDates(now, days, settings.tokenGraceDays ?? 7);
  const token = newToken();
  const company = parent.conversation.pending_step?.engine?.datapoints?.legal_name?.display || '';
  const firstName = String(party.name || '').trim().split(/\s+/)[0] || '';
  const request = await E.OutreachRequest.create({
    tenant_id: tenantId, case_id: parent.conversation.case_id, client_id: parent.conversation.client_id, engine: 'conversation', status: 'Sent',
    token_hash: await hashToken(token), token_expires_at: dates.token_expires_at, deadline: dates.deadline.slice(0, 10),
    recipient_email: to, delivery_channel: 'Email', message: `Guided conversation: ${template.name} (${party.name})`,
    related_party_id: party.related_party_id || undefined, parent_request_id: parent.request.id,
    items: [{ item_id: 'idv', label: 'Identity verification', field_type: 'id_verification', item_type: 'data_point', status: 'Pending' }],
  });
  const conv = await E.OutreachConversation.create({
    tenant_id: tenantId, request_id: request.id, case_id: parent.conversation.case_id, client_id: parent.conversation.client_id,
    party_id: party.related_party_id || undefined, parent_conversation_id: parent.conversation.id, status: 'Sent', ...snap,
    language: parent.conversation.language || 'en', risk_class: parent.conversation.risk_class || 'medium', client_type: 'RP',
    org_context: { company, role_text: party.role_text || '' }, ...(parent.conversation.pending_step?.test_data ? { pending_step: { test_data: true } } : {}),
    invited_name: party.name, invited_first_name: firstName, invited_email: to,
    deadline: dates.deadline, token_expires_at: dates.token_expires_at, sent_at: now.toISOString(), sent_by: actor.name || 'System',
    progress_steps: 0, progress_total: initialProgressTotal(snap), block_states: {}, ai_followup_count: 0,
  });
  await E.OutreachRequest.update(request.id, { conversation_id: conv.id });
  await storeLinkToken(E, { tenantId, conversationId: conv.id, requestId: request.id, token, link: `${String(origin || '').replace(/\/+$/, '')}/o/${token}` });
  const open = await E.OutreachOpenRequest.create({ tenant_id: tenantId, conversation_id: parent.conversation.id, title: fillPlaceholders(MESSAGES.ownChecks, { name: party.name }), party_name: party.name, kind: 'own_checks', status: 'open' }).catch(() => null);
  let emailed = false;
  let emailError = null;
  try {
    const link = `${origin}/o/${token}`;
    const mail = inviteEmail({ templates: emailTemplates, clientType: 'RP', vars: { first_name: firstName, tenant_name: tenant?.name || '', link, deadline_date: new Date(dates.deadline).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }), minutes: template.expected_minutes || '' } });
    await base44.asServiceRole.integrations.Core.SendEmail({ from_name: tenant?.email_from_name || tenant?.name || 'Compliance Team', ...(tenant?.email_from_address ? { from_email: tenant.email_from_address } : {}), to, subject: mail.subject, body: mail.body });
    emailed = true;
  } catch (e) { emailError = String(e?.message || e).slice(0, 200); }
  await writeOutreachAudit(E, outreachAuditRow({
    tenantId, event: 'invitation.sent', actor, conversation: { id: parent.conversation.id, request_id: parent.request.id, case_id: parent.conversation.case_id, client_id: parent.conversation.client_id, party_id: party.related_party_id },
    payload: { child_request_id: request.id, child_conversation_id: conv.id, party: party.name, emailed, email_error: emailError, open_request_id: open?.id || null },
    notes: `Invitation sent${emailed ? ' by email' : ' (email failed)'} (tipping-off check passed)`,
  }));
  return { ok: true, child_request_id: request.id, conversation_id: conv.id, emailed, email_error: emailError, open_request_id: open?.id || null };
}
