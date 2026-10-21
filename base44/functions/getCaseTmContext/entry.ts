// getCaseTmContext — read-only TM context for a KYC case. Requires tm_core. Writes nothing (no AuditEvent).
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.52';
import { isTmEnabled } from '../../shared/tmGuards.js';
import { errorResponse, httpError, loadTenant, asList } from '../../shared/tmAuth.js';
import { authorizeCaller, buildCaseTmContext } from '../../shared/customerFile.js';

export default async function (req) {
  try {
    const base44 = createClientFromRequest(req);
    const body = await req.json();
    if (!body.kyc_case_id) throw httpError(400, 'kyc_case_id is required');
    const E = base44.asServiceRole.entities;
    const { tenantId, role } = await authorizeCaller(base44, req, body, async () => {
      const c = asList(await E.KycCase.filter({ id: body.kyc_case_id }, undefined, 1))[0];
      if (!c) throw httpError(404, 'KYC case not found');
      return c.tenant_id;
    });
    const tenant = await loadTenant(base44, tenantId);
    if (!isTmEnabled(tenant, 'tm_core')) throw httpError(403, 'Feature tm_core is not enabled');
    const kycCase = asList(await E.KycCase.filter({ tenant_id: tenantId, id: body.kyc_case_id }, undefined, 1))[0];
    if (!kycCase) throw httpError(404, 'KYC case not found');
    return Response.json(await buildCaseTmContext(base44, { tenantId, tenant, kycCase, role }));
  } catch (error) {
    console.error('getCaseTmContext error:', error?.message);
    return errorResponse(error);
  }
}