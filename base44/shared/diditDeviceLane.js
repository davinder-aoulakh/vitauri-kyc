// Device / event lane helpers for tenant systems that talk to Didit directly.
// vendor_data is ALWAYS resolved here from the tenant's own Client (by Vitauri id or external_id) — never taken from the caller.
import { authenticate, httpError, asList, loadTenantWithDiditCredentials } from './tmAuth.js';
import { isTmEnabled } from './tmGuards.js';

export const TM_TOKEN_SCOPE = 'tm:token';

/** API key with scope tm:token only (user sessions are rejected). Returns { auth, tenant } with Didit credentials loaded. */
export async function authenticateDeviceLane(base44, req, body) {
  const auth = await authenticate(base44, req, body, { roles: [], allowApiKey: true, scope: TM_TOKEN_SCOPE });
  if (auth.mode !== 'api_key') throw httpError(403, 'API key required');
  const tenant = await loadTenantWithDiditCredentials(base44, auth.tenantId);
  if (!isTmEnabled(tenant, 'tm_core')) throw httpError(403, 'Transaction monitoring is not enabled');
  if (!tenant?.didit_api_key) throw httpError(412, 'Didit is not configured for this institution');
  return { auth, tenant };
}

/** Find the client inside the caller's tenant by client_id or external_id. */
export async function resolveClient(base44, tenantId, { client_id, external_id } = {}) {
  const E = base44.asServiceRole.entities;
  let client = null;
  if (client_id) client = asList(await E.Client.filter({ tenant_id: tenantId, id: String(client_id) }, undefined, 1))[0];
  else if (external_id) client = asList(await E.Client.filter({ tenant_id: tenantId, external_id: String(external_id) }, undefined, 2))[0];
  else throw httpError(400, 'client_id or external_id is required');
  if (!client || client.tenant_id !== tenantId) throw httpError(404, 'Client not found');
  return client;
}

export const clampTtl = (v) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.min(Math.floor(n), 86400) : undefined;
};
export const clampUses = (v) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.min(Math.floor(n), 1000) : undefined;
};
