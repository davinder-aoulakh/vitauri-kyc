// generateDiditFiuReport — creates the goAML file for an APPROVED FIU report through Didit.
// Auth: signed-in Compliance Officer (tmApproveFiuReport); tenant from the user. On failure the report stays approved and the error is stored for retry.
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.52';
import { isTmEnabled } from '../../shared/tmGuards.js';
import { authenticate, errorResponse, httpError, loadTenantWithDiditCredentials } from '../../shared/tmAuth.js';
import { CO_ROLES } from '../../shared/tmCaseCommon.js';
import { loadReport } from '../../shared/tmFiuActions.js';
import { generateReport } from '../../shared/tmFiuGenerate.js';

export default async function (req) {
  try {
    const base44 = createClientFromRequest(req);
    const body = await req.json();
    const auth = await authenticate(base44, req, body, { roles: CO_ROLES, allowApiKey: false });
    const tenantId = auth.tenantId;
    const tenant = await loadTenantWithDiditCredentials(base44, tenantId);
    if (!isTmEnabled(tenant, 'tm_core')) throw httpError(403, 'Feature tm_core is not enabled');
    if (!isTmEnabled(tenant, 'tm_fiu')) throw httpError(403, 'Feature tm_fiu is not enabled');
    const E = base44.asServiceRole.entities;
    const report = await loadReport(E, tenantId, body.report_id);
    const result = await generateReport({ base44, E, auth, tenantId, tenant }, report);
    return Response.json({ ok: true, ...result });
  } catch (error) {
    console.error('generateDiditFiuReport error:', error?.message);
    return errorResponse(error);
  }
}