// getFiuArtefactUrl — short-lived signed link to one FiuArtefact file (read only, writes nothing).
// Auth: signed-in user with a role that may read FiuArtefact; tenant from the user. Requires tm_core + tm_fiu.
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.52';
import { isTmEnabled } from '../../shared/tmGuards.js';
import { authenticate, errorResponse, httpError, loadTenant, asList } from '../../shared/tmAuth.js';

const ARTEFACT_READERS = ['Analyst', 'QC Reviewer', 'Compliance Officer', 'Manager', 'Director', 'Compliance Admin', 'Tenant Admin']; // FiuArtefact RLS read

export default async function (req) {
  try {
    const base44 = createClientFromRequest(req);
    const body = await req.json();
    const auth = await authenticate(base44, req, body, { roles: ARTEFACT_READERS, allowApiKey: false });
    const tenantId = auth.tenantId;
    const tenant = await loadTenant(base44, tenantId);
    if (!isTmEnabled(tenant, 'tm_core')) throw httpError(403, 'Feature tm_core is not enabled');
    if (!isTmEnabled(tenant, 'tm_fiu')) throw httpError(403, 'Feature tm_fiu is not enabled');
    if (!body.artefact_id) throw httpError(400, 'artefact_id is required');
    const a = asList(await base44.asServiceRole.entities.FiuArtefact.filter({ tenant_id: tenantId, id: body.artefact_id }, undefined, 1))[0];
    if (!a || a.tenant_id !== tenantId) throw httpError(404, 'File not found');
    if (!a.file_url) throw httpError(404, 'No file is attached to this record');
    if (/^https?:\/\//i.test(a.file_url)) return Response.json({ ok: true, signed_url: a.file_url });
    const res = await base44.asServiceRole.integrations.Core.CreateFileSignedUrl({ file_uri: a.file_url, expires_in: 300 });
    return Response.json({ ok: true, signed_url: res.signed_url });
  } catch (error) {
    console.error('getFiuArtefactUrl error:', error?.message);
    return errorResponse(error);
  }
}
