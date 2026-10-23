// sendOutreachEmail — sends a customer communication email after a server-side tipping-off check.
// Refuses with 423 while the customer has an active TippingOffLock (FIU report in progress).
//   { client_id, to, subject, body, case_id?, outreach_request_id? }
// The sender name/address come from the tenant settings. The tenant object is never returned.
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.52';
import { writeAudit } from '../../shared/tmAudit.js';
import { assertNotLocked } from '../../shared/tippingOff.js';
import { authenticate, errorResponse, httpError, loadTenant, WORK_ROLES } from '../../shared/tmAuth.js';

const ROLES = [...WORK_ROLES, 'Director', 'Compliance Admin', 'Tenant Admin'];
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default async function (req) {
  try {
    const base44 = createClientFromRequest(req);
    const body = await req.json();
    const auth = await authenticate(base44, req, body, { roles: ROLES, allowApiKey: false });
    const tenantId = auth.tenantId;

    const to = String(body.to || '').trim();
    const subject = String(body.subject || '').trim();
    const html = String(body.body || '');
    if (!EMAIL_RE.test(to)) throw httpError(400, 'A valid recipient email is required');
    if (!subject || !html) throw httpError(400, 'subject and body are required');

    // 404 when the client is not in this tenant, 423 when communications are locked.
    await assertNotLocked(base44, body.client_id, tenantId);

    const tenant = await loadTenant(base44, tenantId);
    await base44.asServiceRole.integrations.Core.SendEmail({
      from_name: tenant?.email_from_name || tenant?.name || 'Compliance Team',
      ...(tenant?.email_from_address ? { from_email: tenant.email_from_address } : {}),
      to, subject, body: html,
    });

    await writeAudit(base44, auth, {
      tenantId, clientId: body.client_id, eventType: 'outreach_email_sent',
      after: { to, subject, case_id: body.case_id || null, outreach_request_id: body.outreach_request_id || null },
      notes: `Customer email "${subject}" sent to ${to} by ${auth.actorName} (tipping-off check passed).`,
    });
    return Response.json({ ok: true });
  } catch (error) {
    return errorResponse(error);
  }
}
