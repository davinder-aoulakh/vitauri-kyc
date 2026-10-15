// Didit credentials live in TenantSecret (backend only). During F02 the same values are still mirrored on Tenant.
// Never log or return key / secret values from here.

const asRows = (res) => (Array.isArray(res) ? res : (res?.items || []));

async function findSecret(base44, tenantId) {
  const res = await base44.asServiceRole.entities.TenantSecret.filter({ tenant_id: tenantId }, undefined, 1);
  return asRows(res)[0] || null;
}

/** Shallow copy of the tenant whose Didit key/secret come from TenantSecret when present, else from the tenant itself. */
export async function withDiditCredentials(base44, tenant) {
  if (!tenant?.id) return tenant;
  let secret = null;
  try { secret = await findSecret(base44, tenant.id); } catch (e) { console.warn('diditCredentials: TenantSecret lookup failed', e?.message); }
  const out = { ...tenant };
  if (secret?.didit_api_key) out.didit_api_key = secret.didit_api_key;
  if (secret?.didit_webhook_secret) out.didit_webhook_secret = secret.didit_webhook_secret;
  out.didit_rotated_at = secret?.rotated_at || null;
  return out;
}

/** Upsert TenantSecret for a tenant. Only non-empty values are written. Returns { created, fields }. */
export async function upsertTenantSecret(base44, tenantId, { didit_api_key, didit_webhook_secret } = {}, userId) {
  const E = base44.asServiceRole.entities;
  const patch = {};
  if (didit_api_key) patch.didit_api_key = didit_api_key;
  if (didit_webhook_secret) patch.didit_webhook_secret = didit_webhook_secret;
  const fields = Object.keys(patch);
  if (!fields.length) return { created: false, fields };
  const stamp = { updated_by_user_id: userId || undefined, rotated_at: new Date().toISOString() };
  const existing = await findSecret(base44, tenantId);
  if (existing) await E.TenantSecret.update(existing.id, { ...patch, ...stamp });
  else await E.TenantSecret.create({ tenant_id: tenantId, ...patch, ...stamp });
  return { created: !existing, fields };
}

/** Upserts TenantSecret only, blanks the deprecated Tenant fields, writes an AuditEvent without values. */
export async function saveDiditCredentials(base44, tenantId, creds, actor) {
  const { fields } = await upsertTenantSecret(base44, tenantId, creds, actor?.actorUserId);
  if (!fields.length) return { saved: false, fields };
  const E = base44.asServiceRole.entities;
  // Secrets live only in TenantSecret; the deprecated Tenant fields must stay empty.
  await E.Tenant.update(tenantId, { didit_api_key: '', didit_webhook_secret: '' });
  await E.AuditEvent.create({
    tenant_id: tenantId,
    actor_user_id: actor?.actorUserId,
    actor_name: actor?.actorName || 'System',
    actor_type: actor?.actorType || 'System',
    event_type: 'didit_credentials_saved',
    before_state: {},
    after_state: { fields_updated: fields },
    notes: `Didit credentials stored securely. Fields: ${fields.join(', ')}.`,
  }).catch((e) => console.warn('diditCredentials: audit failed', e?.message));
  return { saved: true, fields };
}

export function credentialStatus(tenantWithCreds) {
  const key = tenantWithCreds?.didit_api_key || '';
  return {
    api_key_configured: !!key,
    api_key_last4: key ? key.slice(-4) : null,
    webhook_secret_configured: !!tenantWithCreds?.didit_webhook_secret,
    last_rotated_at: tenantWithCreds?.didit_rotated_at || null,
  };
}