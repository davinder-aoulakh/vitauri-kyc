// recomputeCustomerRisk — recompute the dynamic customer risk score for one client.
// Auth: signed-in app user with a work role; tenant comes from the user. Internal callers use ../../shared/tmRisk.js directly.
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.52';
import { isTmEnabled } from '../../shared/tmGuards.js';
import { authenticate, errorResponse, httpError, loadTenant } from '../../shared/tmAuth.js';
import { recomputeCustomerRisk } from '../../shared/tmRisk.js';

const ALL_ROLES = ['Analyst', 'QC Reviewer', 'Compliance Officer', 'Manager', 'Director', 'Compliance Admin', 'Tenant Admin'];

export default async function (req) {
  try {
    const base44 = createClientFromRequest(req);
    const body = await req.json();
    const auth = await authenticate(base44, req, body, { roles: ALL_ROLES, allowApiKey: false });
    if (!body.client_id) throw httpError(400, 'client_id is required');
    const tenant = await loadTenant(base44, auth.tenantId);
    if (!isTmEnabled(tenant, 'tm_core')) throw httpError(403, 'Feature tm_core is not enabled');
    const result = await recomputeCustomerRisk(base44, {
      tenantId: auth.tenantId, tenant, clientId: body.client_id, trigger: String(body.trigger || 'manual').slice(0, 60), actor: auth,
    });
    return Response.json({ ok: true, ...result });
  } catch (error) {
    console.error('recomputeCustomerRisk error:', error?.message);
    return errorResponse(error);
  }
}