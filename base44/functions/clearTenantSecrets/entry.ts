// clearTenantSecrets — Vitauri Ops only. Input { tenant_id: string | 'all', confirm: true }.
// For each tenant that HAS a TenantSecret with a didit_api_key, blanks Tenant.didit_api_key / didit_webhook_secret.
// Tenants without a TenantSecret are skipped and reported. Returns ids/counts only, never values.
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.52';

const rows = (r) => (Array.isArray(r) ? r : (r?.items || []));

export default async function (req) {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me().catch(() => null);
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    if ((user.app_role || user.data?.app_role) !== 'Vitauri Ops') return Response.json({ error: 'Vitauri Ops only' }, { status: 403 });

    const body = await req.json().catch(() => ({}));
    if (body.confirm !== true) return Response.json({ error: 'confirm: true is required' }, { status: 400 });
    if (!body.tenant_id) return Response.json({ error: 'tenant_id or "all" is required' }, { status: 400 });

    const E = base44.asServiceRole.entities;
    const tenants = body.tenant_id === 'all'
      ? rows(await E.Tenant.list('-created_date', 1000))
      : rows(await E.Tenant.filter({ id: body.tenant_id }, undefined, 1));
    if (!tenants.length) return Response.json({ error: 'Tenant not found' }, { status: 404 });

    const cleared: string[] = [];
    const skipped: { tenant_id: string; reason: string }[] = [];
    const failed: string[] = [];

    for (const t of tenants) {
      try {
        const secret = rows(await E.TenantSecret.filter({ tenant_id: t.id }, undefined, 1))[0];
        if (!secret?.didit_api_key) { skipped.push({ tenant_id: t.id, reason: 'no TenantSecret with an API key' }); continue; }
        const hadKey = !!t.didit_api_key;
        const hadSecret = !!t.didit_webhook_secret;
        await E.Tenant.update(t.id, { didit_api_key: '', didit_webhook_secret: '' });
        await E.AuditEvent.create({
          tenant_id: t.id, actor_user_id: user.id, actor_name: user.full_name || user.email, actor_type: 'User',
          event_type: 'didit_tenant_secrets_cleared',
          before_state: { tenant_api_key_present: hadKey, tenant_webhook_secret_present: hadSecret },
          after_state: { tenant_api_key_present: false, tenant_webhook_secret_present: false },
          notes: 'Deprecated Didit secret fields on the Tenant record were emptied. Values remain in TenantSecret.',
        });
        cleared.push(t.id);
      } catch (e) {
        failed.push(t.id);
        console.warn('clearTenantSecrets: tenant failed', t.id, e?.message);
      }
    }
    return Response.json({ cleared_count: cleared.length, cleared, skipped, failed });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}