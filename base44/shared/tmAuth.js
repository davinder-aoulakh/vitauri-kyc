// Caller authentication + tenant scoping for the TM pipeline functions.
// Tenant scope comes ONLY from a verified tenant API key or from the authenticated user's own tenant.
// Keep role lists in sync with tmManageIngest / tmWorkCase in src/lib/permissions.js.
import { sha256Hex } from './tmCanonical.js';

export const INGEST_ROLES = ['Tenant Admin', 'Compliance Admin']; // tmManageIngest
export const WORK_ROLES = ['Analyst', 'QC Reviewer', 'Compliance Officer', 'Manager']; // tmWorkCase

export function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

export function errorResponse(error) {
  const status = error?.status && Number.isInteger(error.status) ? error.status : 500;
  return Response.json({ error: error?.message || String(error) }, { status });
}

/**
 * options: { roles: string[] (user roles allowed), allowApiKey: boolean, scope: string }
 * Returns { mode: 'api_key'|'user', tenantId, actorName, actorType, actorUserId, apiKey, apiKeyId, apiKeyRaw }
 * Throws httpError on any failure. A payload tenant_id that differs from the verified scope is rejected.
 */
export async function authenticate(base44, req, body, options = {}) {
  const { roles = [], allowApiKey = true, scope = 'ingest:write' } = options;
  const payloadTenant = body?.tenant_id;
  const rawKey = req.headers.get('x-api-key') || body?.api_key;

  if (rawKey) {
    if (!allowApiKey) throw httpError(403, 'API key access is not allowed for this function');
    const hash = await sha256Hex(String(rawKey));
    const res = await base44.asServiceRole.entities.TenantApiKey.filter({ key_hash: hash }, undefined, 1);
    const keys = Array.isArray(res) ? res : (res?.items || []);
    const key = keys[0];
    if (!key || key.revoked_at) throw httpError(401, 'Invalid or revoked API key');
    if (!(key.scopes || ['ingest:write']).includes(scope)) throw httpError(403, `API key lacks scope ${scope}`);
    if (payloadTenant && payloadTenant !== key.tenant_id) throw httpError(403, 'tenant_id does not match API key');
    base44.asServiceRole.entities.TenantApiKey.update(key.id, { last_used_at: new Date().toISOString() }).catch(() => {});
    return {
      mode: 'api_key', tenantId: key.tenant_id, actorType: 'System',
      actorName: `API key ${key.key_prefix || key.label || key.id}`, actorUserId: undefined,
      apiKeyId: key.id, apiKeyRaw: String(rawKey),
    };
  }

  const user = await base44.auth.me().catch(() => null);
  if (!user) throw httpError(401, 'Unauthorized');
  const tenantId = user.tenant_id || user.data?.tenant_id;
  if (!tenantId) throw httpError(403, 'No tenant associated with this user');
  const role = user.app_role || user.data?.app_role;
  if (!role || !roles.includes(role)) throw httpError(403, 'Forbidden');
  if (payloadTenant && payloadTenant !== tenantId) throw httpError(403, 'tenant_id does not match your tenant');
  return {
    mode: 'user', tenantId, actorType: 'User', actorName: user.full_name || user.email,
    actorUserId: user.id, apiKeyId: undefined, apiKeyRaw: undefined,
  };
}

/** Invoke another pipeline function, forwarding the caller's credentials. */
export async function invokeNext(base44, auth, name, payload) {
  const res = auth.mode === 'api_key'
    ? await base44.asServiceRole.functions.invoke(name, { ...payload, api_key: auth.apiKeyRaw })
    : await base44.functions.invoke(name, payload);
  return res?.data ?? res;
}

export async function loadTenant(base44, tenantId) {
  const res = await base44.asServiceRole.entities.Tenant.filter({ id: tenantId });
  const list = Array.isArray(res) ? res : (res?.items || []);
  const tenant = list.find((t) => t.id === tenantId);
  if (!tenant) throw httpError(404, 'Tenant not found');
  return tenant;
}

/** Run async fn over items with bounded concurrency. Returns array of settled-like results. */
export async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      try { out[idx] = { ok: true, value: await fn(items[idx], idx) }; } catch (e) { out[idx] = { ok: false, error: e }; }
    }
  });
  await Promise.all(workers);
  return out;
}

export function chunk(arr, n) {
  const out = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

export function asList(res) {
  return Array.isArray(res) ? res : (res?.items || []);
}