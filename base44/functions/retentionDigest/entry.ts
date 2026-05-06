/**
 * retentionDigest — monthly job that identifies archived clients approaching
 * their retention expiry and emails Compliance Admins.
 * Triggered by scheduled automation (1st of each month).
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

function addYears(date, years) {
  const d = new Date(date);
  d.setFullYear(d.getFullYear() + years);
  return d;
}

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);

  // Allow scheduled invocation (no user) or admin user
  let isAuthorised = false;
  try {
    const user = await base44.auth.me();
    if (user?.role === 'admin' || ['Compliance Admin', 'Tenant Admin'].includes(user?.app_role)) {
      isAuthorised = true;
    }
  } catch {
    // Scheduled call — no user session, use service role
    isAuthorised = true;
  }

  if (!isAuthorised) {
    return Response.json({ error: 'Forbidden' }, { status: 403 });
  }

  const ARCHIVE_STATUSES = ['Inactive', 'Former', 'Rejected', 'Unacceptable'];
  const WARN_DAYS = 90; // warn when within 90 days

  // Get all tenants
  const tenants = await base44.asServiceRole.entities.Tenant.list();
  const results = [];

  for (const tenant of tenants) {
    if (tenant.status !== 'Active') continue;

    const retentionYears = tenant.audit_retention_years || 5;

    // Get archived clients
    const clients = await base44.asServiceRole.entities.Client.filter({ tenant_id: tenant.id });
    const archived = (clients || []).filter(c => ARCHIVE_STATUSES.includes(c.status));

    if (archived.length === 0) continue;

    // Get all closed cases to determine base retention date
    const cases = await base44.asServiceRole.entities.KycCase.filter({ tenant_id: tenant.id });
    const closedCases = (cases || []).filter(c => ['Approved', 'Closed', 'Rejected'].includes(c.status));

    const approaching = [];
    const now = new Date();

    for (const client of archived) {
      // Find most recent closed case
      const clientCases = closedCases
        .filter(c => c.client_id === client.id)
        .sort((a, b) => new Date(b.updated_date || 0) - new Date(a.updated_date || 0));
      const lastCase = clientCases[0];
      const baseDate = lastCase?.completed_at || lastCase?.updated_date || client.updated_date;
      if (!baseDate) continue;

      const expiryDate = addYears(new Date(baseDate), retentionYears);
      const daysRemaining = Math.round((expiryDate - now) / (1000 * 60 * 60 * 24));

      if (daysRemaining <= WARN_DAYS && daysRemaining > 0) {
        approaching.push({
          client_name: client.full_name,
          client_id: client.id,
          status: client.status,
          expiry_date: expiryDate.toISOString().split('T')[0],
          days_remaining: daysRemaining,
        });
      }
    }

    if (approaching.length === 0) continue;

    // Sort by soonest expiry
    approaching.sort((a, b) => a.days_remaining - b.days_remaining);

    // Find Compliance Admin users for this tenant
    const users = await base44.asServiceRole.entities.User.list();
    const admins = (users || []).filter(u =>
      u.tenant_id === tenant.id &&
      ['Compliance Admin', 'Tenant Admin'].includes(u.app_role)
    );

    for (const admin of admins) {
      if (!admin.email) continue;

      const rows = approaching.map(c =>
        `• ${c.client_name} (${c.status}) — expires ${c.expiry_date} (${c.days_remaining} days)`
      ).join('\n');

      await base44.asServiceRole.integrations.Core.SendEmail({
        to: admin.email,
        subject: `[Vitauri KYC] Records approaching retention expiry — ${tenant.name}`,
        body: `Dear ${admin.full_name || 'Compliance Administrator'},\n\nThe following archived client records are approaching their ${retentionYears}-year retention expiry at ${tenant.name}:\n\n${rows}\n\nPlease review these records in the Archive module and confirm whether they should be deleted or retention extended with documented justification.\n\nThis is an automated monthly digest from the Vitauri KYC platform.\n\nNote: This list is scoped to ${tenant.name} only (GDPR compliant, no cross-tenant data).`,
      });

      // Also create in-app notification
      await base44.asServiceRole.entities.Notification.create({
        tenant_id: tenant.id,
        user_id: admin.id,
        type: 'control_measure_due',
        title: `${approaching.length} client record(s) approaching retention expiry`,
        body: `${approaching.length} archived client record(s) will expire within ${WARN_DAYS} days. Review required in Archive module.`,
      });
    }

    results.push({ tenant: tenant.name, approaching: approaching.length });
  }

  return Response.json({
    processed: tenants.length,
    results,
    run_at: new Date().toISOString(),
  });
});