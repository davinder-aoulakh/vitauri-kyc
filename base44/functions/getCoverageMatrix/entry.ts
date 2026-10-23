// getCoverageMatrix — the tenant's risk coverage matrix computed on the server (see shared/tmCoverageMatrix.js),
// so the model-validation export and MI report the same figures as the Quality page.
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.52';
import { isTmEnabled } from '../../shared/tmGuards.js';
import { buildCoverageMatrix } from '../../shared/tmCoverageMatrix.js';
import { authenticate, errorResponse, httpError, loadTenant, asList } from '../../shared/tmAuth.js';

const ROLES = ['QC Reviewer', 'Compliance Officer', 'Compliance Admin', 'Director', 'Manager', 'Tenant Admin'];

export default async function (req) {
  try {
    const base44 = createClientFromRequest(req);
    const body = await req.json().catch(() => ({}));
    const auth = await authenticate(base44, req, body, { roles: ROLES, allowApiKey: false });
    const tenantId = auth.tenantId;
    const tenant = await loadTenant(base44, tenantId);
    if (!isTmEnabled(tenant, 'tm_core')) throw httpError(403, 'Feature tm_core is not enabled');

    const E = base44.asServiceRole.entities;
    const t = { tenant_id: tenantId };
    const [risks, scenarios, rules, backtests, samples, users] = await Promise.all([
      E.TmRisk.filter(t, 'code', 500).then(asList),
      E.TmScenario.filter(t, 'code', 2000).then(asList),
      E.TmRule.filter(t, '-created_date', 2000).then(asList),
      E.RuleBacktest.filter(t, '-created_date', 1000).then(asList),
      E.QualitySample.filter(t, '-created_date', 500).then(asList),
      E.User.list('-created_date', 5000).then(asList).catch(() => []),
    ]);
    const usersById = new Map(users.filter((u) => (u.tenant_id || u.data?.tenant_id) === tenantId).map((u) => [u.id, { full_name: u.full_name, email: u.email }]));
    const { rows, counts } = buildCoverageMatrix({ risks, scenarios, rules, backtests, samples, usersById });
    return Response.json({ ok: true, computed_at: new Date().toISOString(), counts, rows });
  } catch (error) {
    return errorResponse(error);
  }
}
