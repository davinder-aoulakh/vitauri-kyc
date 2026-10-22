// manageTenantApiKey — create / revoke / list tenant API keys. User session with tmManageIngest only.
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.52';
import { isTmEnabled } from '../../shared/tmGuards.js';
import { writeAudit } from '../../shared/tmAudit.js';
import { generateApiKey, publicKey } from '../../shared/tmApiKeys.js';
import { authenticate, errorResponse, httpError, loadTenant, asList, INGEST_ROLES } from '../../shared/tmAuth.js';

export default async function (req) {
  try {
    const base44 = createClientFromRequest(req);
    const body = await req.json().catch(() => ({}));
    const auth = await authenticate(base44, req, { tenant_id: body?.tenant_id }, { roles: INGEST_ROLES, allowApiKey: false });
    const tenantId = auth.tenantId;
    const tenant = await loadTenant(base44, tenantId);
    if (!isTmEnabled(tenant, 'tm_ingest_api')) throw httpError(403, 'Feature tm_ingest_api is not enabled');
    const E = base44.asServiceRole.entities;
    const { action } = body;

    if (action === 'list') {
      const keys = asList(await E.TenantApiKey.filter({ tenant_id: tenantId }, '-created_date', 200));
      return Response.json({ keys: keys.map(publicKey) });
    }

    if (action === 'create') {
      const label = String(body.label ?? '').trim();
      if (!label || label.length > 80) throw httpError(400, 'label is required (max 80 characters)');
      // Optional extra scope 'tm:token' (Didit device tokens + event ingest); default stays ingest:write only.
      const scopes = Array.isArray(body.scopes) && body.scopes.includes('tm:token') ? ['ingest:write', 'tm:token'] : ['ingest:write'];
      const { key, key_prefix, key_hash } = await generateApiKey();
      const rec = await E.TenantApiKey.create({
        tenant_id: tenantId, label, key_prefix, key_hash, scopes, created_by_user_id: auth.actorUserId,
      });
      await writeAudit(base44, auth, {
        tenantId, eventType: 'tm_api_key_created', before: {},
        after: { id: rec.id, label, key_prefix, scopes },
        notes: `API key "${label}" (${key_prefix}…) created.`,
      });
      return Response.json({ key: publicKey(rec), plaintext_key: key });
    }

    if (action === 'revoke') {
      if (!body.id || typeof body.id !== 'string') throw httpError(400, 'id is required');
      const rec = asList(await E.TenantApiKey.filter({ tenant_id: tenantId, id: body.id }, undefined, 1))[0];
      if (!rec) throw httpError(404, 'Key not found');
      if (rec.revoked_at) throw httpError(409, 'Key is already revoked');
      const revokedAt = new Date().toISOString();
      await E.TenantApiKey.update(rec.id, { revoked_at: revokedAt });
      await writeAudit(base44, auth, {
        tenantId, eventType: 'tm_api_key_revoked',
        before: { id: rec.id, label: rec.label, key_prefix: rec.key_prefix, revoked_at: null },
        after: { id: rec.id, label: rec.label, key_prefix: rec.key_prefix, revoked_at: revokedAt },
        notes: `API key "${rec.label}" (${rec.key_prefix}…) revoked.`,
      });
      return Response.json({ key: publicKey({ ...rec, revoked_at: revokedAt }) });
    }

    throw httpError(400, "action must be 'create', 'revoke' or 'list'");
  } catch (error) {
    return errorResponse(error);
  }
}