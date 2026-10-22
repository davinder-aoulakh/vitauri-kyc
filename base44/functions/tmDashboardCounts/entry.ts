// tmDashboardCounts — read-only TM counts for the dashboard KPI row (one call). Writes nothing (no AuditEvent).
// Auth: signed-in user with tmViewAlerts; tenant from the user. Requires tm_core. The FIU count is null unless tm_fiu is on.
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.52';
import { isTmEnabled } from '../../shared/tmGuards.js';
import { authenticate, errorResponse, httpError, loadTenant, asList } from '../../shared/tmAuth.js';

const TM_VIEW_ALERTS = ['Analyst', 'QC Reviewer', 'Compliance Officer', 'Manager', 'Director', 'Compliance Admin', 'Tenant Admin']; // tmViewAlerts
const OPEN_ALERT = ['new', 'triaged', 'in_review', 'escalated'];
const LIMIT = 5000;

const countOf = async (entity, query) => asList(await entity.filter(query, { limit: LIMIT, fields: ['id'] })).length;

export default async function (req) {
  try {
    const base44 = createClientFromRequest(req);
    const body = await req.json().catch(() => ({}));
    const auth = await authenticate(base44, req, body, { roles: TM_VIEW_ALERTS, allowApiKey: false });
    const tenantId = auth.tenantId;
    const tenant = await loadTenant(base44, tenantId);
    if (!isTmEnabled(tenant, 'tm_core')) throw httpError(403, 'Feature tm_core is not enabled');
    const E = base44.asServiceRole.entities;
    const now = Date.now();

    const [alertsDueSoon, pendingCo, fiuAwaiting, edrProposals] = await Promise.all([
      countOf(E.TmAlert, { tenant_id: tenantId, status: { $in: OPEN_ALERT }, due_at: { $gte: new Date(now).toISOString(), $lt: new Date(now + 86400000).toISOString() } }),
      countOf(E.TmCase, { tenant_id: tenantId, status: 'pending_co' }),
      isTmEnabled(tenant, 'tm_fiu') ? countOf(E.FiuReport, { tenant_id: tenantId, status: 'generated' }) : Promise.resolve(null),
      countOf(E.EdrTrigger, { tenant_id: tenantId, status: 'proposed' }),
    ]);
    return Response.json({ ok: true, alerts_due_24h: alertsDueSoon, pending_co: pendingCo, fiu_awaiting_submission: fiuAwaiting, edr_proposals: edrProposals });
  } catch (error) {
    console.error('tmDashboardCounts error:', error?.message);
    return errorResponse(error);
  }
}
