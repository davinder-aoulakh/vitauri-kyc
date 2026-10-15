// migrateDiditSecrets — Vitauri Ops only. Copies each tenant's Didit key/secret into TenantSecret.
// Input { dry_run: boolean }. Returns counts only, never values.
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.52';
import { upsertTenantSecret } from '../../shared/diditCredentials.js';

export default async function (req) {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me().catch(() => null);
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    const role = user.app_role || user.data?.app_role;
    if (role !== 'Vitauri Ops') return Response.json({ error: 'Vitauri Ops only' }, { status: 403 });

    const body = await req.json().catch(() => ({}));
    const dryRun = body.dry_run !== false; // default to a dry run unless explicitly false
    const E = base44.asServiceRole.entities;

    const res = await E.Tenant.list('-created_date', 1000);
    const tenants = Array.isArray(res) ? res : (res?.items || []);
    const counts = { tenants_scanned: tenants.length, with_credentials: 0, migrated: 0, created: 0, updated: 0, failed: 0, dry_run: dryRun };

    for (const t of tenants) {
      if (!t.didit_api_key && !t.didit_webhook_secret) continue;
      counts.with_credentials++;
      if (dryRun) continue;
      try {
        const { created, fields } = await upsertTenantSecret(base44, t.id, { didit_api_key: t.didit_api_key, didit_webhook_secret: t.didit_webhook_secret }, user.id);
        counts.migrated++;
        if (created) counts.created++; else counts.updated++;
        await E.AuditEvent.create({
          tenant_id: t.id, actor_user_id: user.id, actor_name: user.full_name || user.email, actor_type: 'User',
          event_type: 'didit_secrets_migrated', before_state: {}, after_state: { fields_migrated: fields },
          notes: `Didit credentials copied to protected storage. Fields: ${fields.join(', ')}.`,
        }).catch((e) => console.warn('migrateDiditSecrets: audit failed', e?.message));
      } catch (e) {
        counts.failed++;
        console.warn('migrateDiditSecrets: tenant failed', t.id, e?.message);
      }
    }
    return Response.json(counts);
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}