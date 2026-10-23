// backfillAlertRefs — give existing TmAlerts a readable reference (AL-<year>-<seq>), oldest first.
// Vitauri Ops: one tenant (tenant_id) or all tm_core tenants; Tenant Admin: own tenant. Idempotent: alerts with a ref are skipped.
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.52';
import { isTmEnabled } from '../../shared/tmGuards.js';
import { asList, errorResponse, httpError } from '../../shared/tmAuth.js';

const MAX_PER_TENANT = 5000;

async function backfillTenant(base44, tenantId, actor) {
  const E = base44.asServiceRole.entities;
  const all = [];
  for (let skip = 0; skip < MAX_PER_TENANT; skip += 500) {
    const page = asList(await E.TmAlert.filter({ tenant_id: tenantId }, 'created_date', 500, skip));
    all.push(...page);
    if (page.length < 500) break;
  }
  const next = {};
  for (const a of all) {
    const m = /^AL-(\d{4})-(\d+)$/.exec(a.ref || '');
    if (m) next[m[1]] = Math.max(next[m[1]] || 0, parseInt(m[2], 10));
  }
  let updated = 0;
  for (const a of all) {
    if (a.ref) continue;
    const year = String(new Date(a.created_date || a.discovered_at || Date.now()).getUTCFullYear());
    next[year] = (next[year] || 0) + 1;
    await E.TmAlert.update(a.id, { ref: `AL-${year}-${String(next[year]).padStart(4, '0')}` });
    updated++;
  }
  if (updated > 0) {
    await E.AuditEvent.create({
      tenant_id: tenantId, actor_type: actor ? 'User' : 'System', actor_user_id: actor?.id, actor_name: actor?.full_name || 'System',
      event_type: 'tm_alert_refs_backfilled', after_state: { updated }, notes: `Readable references assigned to ${updated} alert(s).`,
    }).catch(() => {});
  }
  return { tenant_id: tenantId, scanned: all.length, updated };
}

export default async function (req) {
  try {
    const base44 = createClientFromRequest(req);
    const body = await req.json().catch(() => ({}));
    const user = await base44.auth.me().catch(() => null);
    if (!user) throw httpError(401, 'Unauthorized');
    const role = user.app_role || user.data?.app_role;
    if (!['Vitauri Ops', 'Tenant Admin'].includes(role)) throw httpError(403, 'Forbidden');
    const own = user.tenant_id || user.data?.tenant_id;
    const wanted = role === 'Vitauri Ops' ? body.tenant_id || null : own;
    if (role !== 'Vitauri Ops' && body.tenant_id && body.tenant_id !== own) throw httpError(403, 'Forbidden');

    const tenants = asList(await base44.asServiceRole.entities.Tenant.list('-created_date', 1000))
      .filter((t) => isTmEnabled(t, 'tm_core') && (!wanted || t.id === wanted));
    const results = [];
    for (const t of tenants) results.push(await backfillTenant(base44, t.id, user));
    return Response.json({ tenants: results.length, results });
  } catch (error) {
    return errorResponse(error);
  }
}
