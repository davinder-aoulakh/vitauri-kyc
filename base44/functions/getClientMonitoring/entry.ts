// getClientMonitoring — read model for the client Monitoring tab (risk, profile vs actual, chart, coverage, timeline).
// Auth: signed-in user with createRunCase; tenant comes from the user. Requires tm_core.
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.52';
import { isTmEnabled } from '../../shared/tmGuards.js';
import { authenticate, errorResponse, httpError, loadTenant, asList } from '../../shared/tmAuth.js';
import { CREATE_RUN_CASE, buildMonitoringModel } from '../../shared/customerFile.js';

export default async function (req) {
  try {
    const base44 = createClientFromRequest(req);
    const body = await req.json();
    const auth = await authenticate(base44, req, body, { roles: CREATE_RUN_CASE, allowApiKey: false });
    const tenantId = auth.tenantId;
    if (!body.client_id) throw httpError(400, 'client_id is required');
    const tenant = await loadTenant(base44, tenantId);
    if (!isTmEnabled(tenant, 'tm_core')) throw httpError(403, 'Feature tm_core is not enabled');
    const client = asList(await base44.asServiceRole.entities.Client.filter({ tenant_id: tenantId, id: body.client_id }))[0];
    if (!client) throw httpError(404, 'Client not found');
    return Response.json(await buildMonitoringModel(base44, tenantId, tenant, client));
  } catch (error) {
    console.error('getClientMonitoring error:', error?.message);
    return errorResponse(error);
  }
}