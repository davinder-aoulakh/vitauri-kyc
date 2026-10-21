// getCustomerFile — read-only customer file for one client. Requires tm_core. Writes nothing (no AuditEvent).
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.52';
import { isTmEnabled } from '../../shared/tmGuards.js';
import { errorResponse, httpError, loadTenant, asList } from '../../shared/tmAuth.js';
import { authorizeCaller, buildCustomerFile } from '../../shared/customerFile.js';

export default async function (req) {
  try {
    const base44 = createClientFromRequest(req);
    const body = await req.json();
    if (!body.client_id) throw httpError(400, 'client_id is required');
    const E = base44.asServiceRole.entities;
    const { tenantId, role } = await authorizeCaller(base44, req, body, async () => {
      const c = asList(await E.Client.filter({ id: body.client_id }, undefined, 1))[0];
      if (!c) throw httpError(404, 'Client not found');
      return c.tenant_id;
    });
    const tenant = await loadTenant(base44, tenantId);
    if (!isTmEnabled(tenant, 'tm_core')) throw httpError(403, 'Feature tm_core is not enabled');
    const client = asList(await E.Client.filter({ tenant_id: tenantId, id: body.client_id }, undefined, 1))[0];
    if (!client) throw httpError(404, 'Client not found');
    const file = await buildCustomerFile(base44, { tenantId, client, role, sections: body.sections });
    return Response.json(file);
  } catch (error) {
    console.error('getCustomerFile error:', error?.message);
    return errorResponse(error);
  }
}