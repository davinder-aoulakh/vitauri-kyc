// sendOutreachConversation — starts a guided conversation outreach for a KYC case: creates the carrier OutreachRequest
// (engine 'conversation', token stored as SHA-256 only) and the OutreachConversation with the frozen template, blocks and
// settings, then emails the link after the tipping-off check.
// Auth: signed-in user with an outreach work role (same roles as sendOutreachEmail); tenant from the user, never the payload.
// Refuses when the flag outreach_conversation is off for the tenant.
// Body: { case_id, invited_name?, invited_email?, deadline_days?, send_email = true, portal_origin }
// Returns { request_id, conversation_id, link } — the link (with the token) is returned once and never stored.
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.52';
import { asList, errorResponse, httpError } from '../../shared/tmAuth.js';
import { assertNotLocked } from '../../shared/tippingOff.js';
import { conversationOn, outreachSettings } from '../../shared/outreachSettings.js';
import { OUTREACH_WORK_ROLES } from '../../shared/outreachAuth.js';
import { newToken, hashToken, linkDates } from '../../shared/outreachToken.js';
import { pickTemplate, buildSnapshot, firstNameOf, initialProgressTotal } from '../../shared/outreachSnapshot.js';
import { outreachAuditRow, writeOutreachAudit } from '../../shared/outreachAudit.js';
import { inviteEmail } from '../../shared/outreachEmail.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const RISK = { Low: 'low', Medium: 'medium', High: 'high', Unacceptable: 'high' };

function originOf(raw) {
  try {
    const u = new URL(String(raw || ''));
    if (u.protocol !== 'https:' && !(u.protocol === 'http:' && /^(localhost|127\.0\.0\.1)$/.test(u.hostname))) return null;
    return u.origin;
  } catch { return null; }
}

export default async function (req) {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me().catch(() => null);
    if (!user) throw httpError(401, 'Unauthorized');
    const role = user.app_role || user.data?.app_role;
    if (!OUTREACH_WORK_ROLES.includes(role)) throw httpError(403, 'You do not have permission to send an outreach');
    const tenantId = user.tenant_id || user.data?.tenant_id;
    if (!tenantId) throw httpError(403, 'No tenant associated with this user');
    const body = await req.json().catch(() => ({}));
    const E = base44.asServiceRole.entities;
    const tenant = asList(await E.Tenant.filter({ id: tenantId }, undefined, 1))[0];
    if (!tenant) throw httpError(404, 'Tenant not found');
    if (!conversationOn(tenant)) throw httpError(403, 'Guided conversation outreach is not switched on for this tenant');

    const kycCase = asList(await E.KycCase.filter({ tenant_id: tenantId, id: body.case_id }, undefined, 1))[0];
    if (!kycCase) throw httpError(404, 'Case not found');
    // 404 when the client is not in this tenant, 423 while customer communications are locked (tipping-off).
    const client = await assertNotLocked(base44, kycCase.client_id, tenantId);
    if (client.is_deleted) throw httpError(404, 'Client not found');
    const origin = originOf(body.portal_origin);
    if (!origin) throw httpError(400, 'portal_origin must be the https address of the app');

    const clientType = client.client_type === 'ORG' ? 'ORG' : 'NP';
    const [templates, blocks, secret, emailTemplates] = await Promise.all([
      E.OutreachFlowTemplate.filter({ tenant_id: tenantId }, undefined, 500).then(asList),
      E.OutreachBlock.filter({ tenant_id: tenantId }, undefined, 2000).then(asList),
      E.TenantSecret.filter({ tenant_id: tenantId }, undefined, 1).then((r) => asList(r)[0] || null),
      E.EmailTemplate.filter({ tenant_id: tenantId }, undefined, 100).then(asList).catch(() => []),
    ]);
    const template = pickTemplate(templates, clientType, kycCase.case_type);
    if (!template) throw httpError(409, `There is no published conversation template for ${clientType} and ${String(kycCase.case_type || '').replace(/_/g, ' ')}. Publish one in Tenant Config first.`);
    const kvkMode = secret?.kvk_mode || 'off';
    // KvK test data must never reach a real client file (plan, phase 1 addition).
    if (clientType === 'ORG' && kvkMode === 'test' && client.status !== 'Prospect') {
      throw httpError(409, 'This tenant uses KvK test data. An organisation conversation can only be sent to a Prospect while the KvK mode is Test.');
    }
    const settings = outreachSettings(tenant);
    let snap;
    try { snap = buildSnapshot({ template, blocks, settings, kvkMode }); } catch (e) { throw httpError(409, e.message); }

    const invitedName = String(body.invited_name || client.primary_contact_name || client.full_name || '').trim().slice(0, 200);
    const invitedEmail = String(body.invited_email || client.primary_contact_email || '').trim().toLowerCase();
    if (!EMAIL_RE.test(invitedEmail)) throw httpError(400, 'A valid email address for the invitation is required');
    const deadlineDays = Number(body.deadline_days) || template.default_deadline_days || settings.defaultDeadlineDays;
    if (deadlineDays < 1 || deadlineDays > 365) throw httpError(400, 'deadline_days must be between 1 and 365');
    const now = new Date();
    const dates = linkDates(now, deadlineDays, settings.tokenGraceDays);
    const token = newToken();
    const tokenHash = await hashToken(token);
    const risk = RISK[kycCase.risk_classification] || RISK[client.risk_classification] || 'medium';
    const firstName = firstNameOf(client, invitedName);
    const actor = { type: 'User', id: user.id, name: user.full_name || user.email };

    // Carrier request: read by the Didit functions and every existing reader of outreach answers. No access_token.
    const request = await E.OutreachRequest.create({
      tenant_id: tenantId, case_id: kycCase.id, client_id: client.id, engine: 'conversation', status: 'Sent',
      token_hash: tokenHash, token_expires_at: dates.token_expires_at, deadline: dates.deadline.slice(0, 10), // OutreachRequest.deadline is a date
      recipient_email: invitedEmail, delivery_channel: 'Email', message: `Guided conversation: ${template.name}`,
      items: [{ item_id: 'idv', label: 'Identity verification', field_type: 'id_verification', item_type: 'data_point', status: 'Pending' }],
    });
    const conversation = await E.OutreachConversation.create({
      tenant_id: tenantId, request_id: request.id, case_id: kycCase.id, client_id: client.id, status: 'Sent',
      ...snap, language: client.language === 'nl' ? 'nl' : 'en', risk_class: risk, client_type: clientType,
      invited_name: invitedName, invited_first_name: firstName, invited_email: invitedEmail,
      deadline: dates.deadline, token_expires_at: dates.token_expires_at, sent_at: now.toISOString(), sent_by: actor.name,
      progress_steps: 0, progress_total: initialProgressTotal(snap), block_states: {}, ai_followup_count: 0,
    });
    await E.OutreachRequest.update(request.id, { conversation_id: conversation.id });
    const conv = { id: conversation.id, request_id: request.id, case_id: kycCase.id, client_id: client.id };

    const link = `${origin}/o/${token}`;
    let emailed = false;
    let emailError = null;
    if (body.send_email !== false) {
      const deadlineDate = new Date(dates.deadline).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
      const mail = inviteEmail({ templates: emailTemplates, clientType, vars: { first_name: firstName, tenant_name: tenant.name, link, deadline_date: deadlineDate, minutes: template.expected_minutes || '' } });
      try {
        await base44.asServiceRole.integrations.Core.SendEmail({
          from_name: tenant.email_from_name || tenant.name || 'Compliance Team',
          ...(tenant.email_from_address ? { from_email: tenant.email_from_address } : {}),
          to: invitedEmail, subject: mail.subject, body: mail.body,
        });
        emailed = true;
      } catch (e) {
        emailError = String(e?.message || e).slice(0, 200);
      }
    }
    await writeOutreachAudit(E, outreachAuditRow({
      tenantId, event: 'request.sent', actor, conversation: conv,
      payload: { template_key: snap.template_key, template_version: snap.template_version, risk_class: risk, kvk_environment: snap.kvk_environment, invited_email: invitedEmail, deadline: dates.deadline, emailed, email_error: emailError },
      notes: `Guided conversation "${template.name}" v${snap.template_version} sent${emailed ? ' by email' : ''} (tipping-off check passed). Deadline ${dates.deadline.slice(0, 10)}.`,
    }));
    return Response.json({ ok: true, request_id: request.id, conversation_id: conversation.id, link, emailed, email_error: emailError, deadline: dates.deadline, template: { key: snap.template_key, name: template.name, version: snap.template_version } });
  } catch (error) {
    console.error('sendOutreachConversation error:', error?.message);
    return errorResponse(error);
  }
}
