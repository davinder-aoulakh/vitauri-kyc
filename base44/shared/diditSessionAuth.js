// Caller check for the person (KYC) session functions. Tenant, client and session always come from the
// stored OutreachRequest, never from the request body.
// Portal callers prove access with the outreach access_token; staff callers must be signed in to the
// outreach's tenant (Vitauri Ops: any tenant).

function denied(status, message) {
  return { error: Response.json({ error: message }, { status }) };
}

/** Returns { outreach, mode: 'portal'|'user', user } or { error: Response }. */
export async function authorizeOutreachCaller(base44, { outreach_id, access_token, tenant_id }) {
  if (!outreach_id) return denied(400, 'outreach_id is required');
  const outreach = (await base44.asServiceRole.entities.OutreachRequest.filter({ id: outreach_id }))?.[0];
  if (!outreach) return denied(404, 'Request not found');
  if (tenant_id && tenant_id !== outreach.tenant_id) return denied(403, 'Not authorised');

  if (access_token) {
    if (!outreach.access_token || String(access_token) !== outreach.access_token) return denied(403, 'Not authorised');
    if (outreach.token_expires_at && Date.parse(outreach.token_expires_at) < Date.now()) return denied(403, 'This link has expired');
    return { outreach, mode: 'portal', user: null };
  }

  const user = await base44.auth.me().catch(() => null);
  if (!user) return denied(401, 'Unauthorized');
  const role = user.app_role || user.data?.app_role;
  const userTenant = user.tenant_id || user.data?.tenant_id;
  if (role !== 'Vitauri Ops' && userTenant !== outreach.tenant_id) return denied(403, 'Not authorised');
  return { outreach, mode: 'user', user };
}

/** Signed-in staff check for functions that take a tenant_id (Vitauri Ops: any tenant). Returns { tenantId, user } or { error }. */
export async function authorizeTenantUser(base44, tenant_id) {
  const user = await base44.auth.me().catch(() => null);
  if (!user) return denied(401, 'Unauthorized');
  const role = user.app_role || user.data?.app_role;
  const userTenant = user.tenant_id || user.data?.tenant_id;
  if (role === 'Vitauri Ops') {
    if (!tenant_id) return denied(400, 'tenant_id is required');
    return { tenantId: tenant_id, user };
  }
  if (!userTenant) return denied(403, 'No tenant associated with this user');
  if (tenant_id && tenant_id !== userTenant) return denied(403, 'Not authorised');
  return { tenantId: userTenant, user };
}
