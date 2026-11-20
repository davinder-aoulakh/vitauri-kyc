// outreachSweep — scheduled (workflow "Outreach Conversation Sweep", hourly) for every tenant with the guided conversation
// flag (plan phase 9, spec 5.6, decision 12):
//   - reminders at the configured days before the deadline (settings.reminderDays), once per value, same link
//     (stored server-only in OutreachLinkToken), after the tipping-off check; audit reminder.sent
//   - expiry: a link past token_expires_at -> conversation and carrier Expired; audit request.expired
//   - held AI follow-ups older than settings.aiApprovalWaitMinutes -> the default question text is sent (ai.followup.default)
// No paid calls. Body { sweep: true } from the workflow; a signed-in Vitauri Ops user may run it with { tenant_id }.
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.52';
import { asList, errorResponse, httpError } from '../../shared/tmAuth.js';
import { conversationOn, outreachSettings } from '../../shared/outreachSettings.js';
import { OPS_ROLE } from '../../shared/outreachAuth.js';
import { remindersDue, linkExpired, followUpTimedOut, SITUATIONS } from '../../shared/outreachSecondRound.js';
import { postHeldFollowUp, sendConversationEmail } from '../../shared/outreachThread.js';
import { fillPlaceholders } from '../../shared/outreachSnapshot.js';
import { outreachAuditRow, writeOutreachAudit } from '../../shared/outreachAudit.js';
import { MESSAGES } from '../../shared/outreachMessages.js';

const MAX_PER_TENANT = 200;

export default async function (req) {
  try {
    const base44 = createClientFromRequest(req);
    const body = await req.json().catch(() => ({}));
    const user = await base44.auth.me().catch(() => null);
    if (user) {
      if ((user.app_role || user.data?.app_role) !== OPS_ROLE) throw httpError(403, 'Forbidden');
    } else if (!body.sweep) {
      throw httpError(401, 'Unauthorized');
    }
    const E = base44.asServiceRole.entities;
    const tenants = asList(await E.Tenant.filter(body.tenant_id ? { id: String(body.tenant_id) } : {}, undefined, 500)).filter(conversationOn);
    const now = new Date();
    const totals = { tenants: tenants.length, reminders: 0, expired: 0, followups: 0, errors: 0 };
    for (const tenant of tenants) {
      const settings = outreachSettings(tenant);
      const convs = asList(await E.OutreachConversation.filter({ tenant_id: tenant.id, status: { $in: ['Sent', 'Opened', 'In_Progress'] } }, 'deadline', MAX_PER_TENANT));
      for (const c of convs) {
        const conv = { id: c.id, request_id: c.request_id || undefined, case_id: c.case_id, client_id: c.client_id, party_id: c.party_id };
        try {
          if (linkExpired(c, now)) {
            await E.OutreachConversation.update(c.id, { status: 'Expired' });
            if (c.request_id) await E.OutreachRequest.update(c.request_id, { status: 'Expired' }).catch(() => {});
            await writeOutreachAudit(E, outreachAuditRow({ tenantId: tenant.id, event: 'request.expired', actor: { type: 'System' }, conversation: conv, notes: 'The link passed its deadline and grace period (sweep).' }));
            totals.expired += 1;
            continue;
          }
          const q = c.pending_step?.engine?.queue?.[0];
          if (followUpTimedOut(q, settings.aiApprovalWaitMinutes, now)) {
            const f = (c.blocks_snapshot?.[q.block]?.follow_ups || []).find((x) => x.id === q.fu) || null;
            const vars = { tenant_name: tenant.name || '', first_name: c.invited_first_name || '', invitation_email: c.invited_email || '' };
            const text = fillPlaceholders(f?.question || '', vars);
            if (text) {
              const minutes = settings.aiApprovalWaitMinutes;
              await postHeldFollowUp(E, {
                tenant, c, text, ai: false, approverName: null, vars, actor: { type: 'System' },
                auditEvent: 'ai.followup.default', auditPayload: { reason: 'approval_timeout', minutes },
                auditNotes: fillPlaceholders(MESSAGES.aiFollowUpTimeout, { minutes }),
              });
              totals.followups += 1;
            }
          }
          const r = remindersDue({ conversation: c, reminderDays: settings.reminderDays, now });
          if (r.due !== null) {
            const mail = await sendConversationEmail(base44, { tenant, c, situation: SITUATIONS.REMINDER });
            if (mail.emailed || mail.locked) {
              await E.OutreachConversation.update(c.id, { reminders_sent: [...new Set([...(c.reminders_sent || []), ...r.mark])] });
            }
            await writeOutreachAudit(E, outreachAuditRow({
              tenantId: tenant.id, event: mail.emailed ? 'reminder.sent' : 'reminder.skipped', actor: { type: 'System' }, conversation: conv,
              payload: { days_before_deadline: r.due, emailed: !!mail.emailed, with_link: !!mail.with_link, error: mail.error || null },
              notes: mail.emailed ? `Reminder sent ${r.due} days before the deadline` : `Reminder not sent: ${mail.error || 'unknown'}`,
            }));
            if (mail.emailed) totals.reminders += 1;
          }
        } catch (e) {
          totals.errors += 1;
          console.warn('outreachSweep conversation failed', c.id, e?.message);
        }
      }
    }
    return Response.json({ ok: true, ...totals });
  } catch (error) {
    if (!error?.status || error.status >= 500) console.error('outreachSweep error:', error?.message);
    return errorResponse(error);
  }
}
