// tmHealth — Vitauri Ops only. One row per tenant, each query filtered by that tenant's id.
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.52';
import { isTmEnabled, TM_KEYS } from '../../shared/tmGuards.js';
import { asList, errorResponse, httpError, mapLimit } from '../../shared/tmAuth.js';

export default async function (req) {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me().catch(() => null);
    if (!user) throw httpError(401, 'Unauthorized');
    if ((user.app_role || user.data?.app_role) !== 'Vitauri Ops') throw httpError(403, 'Vitauri Ops only');

    const E = base44.asServiceRole.entities;
    const tenants = asList(await E.Tenant.list('-created_date', 500));
    const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();

    const rows = await mapLimit(tenants, 4, async (t) => {
      const [cov, hook, failed, drift] = await Promise.all([
        E.AuditEvent.filter({ tenant_id: t.id, event_type: 'tm_coverage_check' }, { sort: '-created_date', limit: 1 }),
        E.DiditWebhookEvent.filter({ tenant_id: t.id }, { sort: '-processed_at', limit: 1 }),
        E.Transaction.count({ tenant_id: t.id, didit_submission_status: 'failed', updated_date: { $gte: since } }),
        E.TmRule.count({ tenant_id: t.id, sync_status: 'drift' }),
      ]);
      return {
        tenant_id: t.id, name: t.name, status: t.status,
        flags: Object.fromEntries(TM_KEYS.map((k) => [k, isTmEnabled(t, k)])),
        last_coverage_run: asList(cov)[0]?.created_date || null,
        last_webhook: asList(hook)[0]?.processed_at || null,
        failed_submissions_24h: failed,
        rules_in_drift: drift,
        legacy_secrets_present: !!(t.didit_api_key || t.didit_webhook_secret),
      };
    });
    return Response.json({ tenants: rows.map((r, i) => (r.ok ? r.value : { tenant_id: tenants[i].id, name: tenants[i].name, error: String(r.error?.message || r.error) })) });
  } catch (error) {
    return errorResponse(error);
  }
}