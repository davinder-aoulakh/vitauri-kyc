// applyDeclinedRetention — sets retention_until on declined/terminated records that have none, from the tenant setting
// sign_off_matrix.retention_months (no default: nothing happens until Compliance / the privacy officer sets it).
// Auth: Tenant Admin or Compliance Admin of the tenant. Never deletes anything. Audited.
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.52';
import { asList, errorResponse, httpError } from '../../shared/tmAuth.js';
import { signoffConfig } from '../../shared/signoffRouting.js';

export default async function (req) {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me().catch(() => null);
    if (!user) throw httpError(401, 'Unauthorized');
    if (!['Tenant Admin', 'Compliance Admin'].includes(user.app_role || user.data?.app_role)) throw httpError(403, 'Only a Tenant Admin or Compliance Admin can apply the retention period');
    const tenantId = user.tenant_id || user.data?.tenant_id;
    const E = base44.asServiceRole.entities;
    const tenant = asList(await E.Tenant.filter({ id: tenantId }, undefined, 1))[0] || {};
    const months = signoffConfig(tenant).retention_months;
    if (!months) return Response.json({ ok: true, updated: 0, reason: 'No retention period is set' });
    const rows = asList(await E.DeclinedRecord.filter({ tenant_id: tenantId }, '-created_date', 2000)).filter((r) => !r.retention_until);
    for (const r of rows) {
      const d = new Date(r.decided_at || r.created_date || Date.now());
      d.setMonth(d.getMonth() + months);
      await E.DeclinedRecord.update(r.id, { retention_until: d.toISOString().slice(0, 10) });
    }
    await E.AuditEvent.create({
      tenant_id: tenantId, actor_user_id: user.id, actor_name: user.full_name || user.email, actor_type: 'User', event_type: 'declined.retention_applied',
      notes: `Retention of ${months} months applied to ${rows.length} declined/terminated record(s) without a retention date.`, after_state: { months, updated: rows.length },
    }).catch(() => {});
    return Response.json({ ok: true, updated: rows.length, months });
  } catch (error) {
    console.error('applyDeclinedRetention error:', error?.message);
    return errorResponse(error);
  }
}
