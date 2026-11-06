// Anthropic (Claude) API key per tenant, stored in TenantSecret (backend only; RLS blocks every app user).
// Never log or return the key: only "configured", the last 4 characters and when it was set.
const asRows = (res) => (Array.isArray(res) ? res : (res?.items || []));

async function findSecret(base44, tenantId) {
  return asRows(await base44.asServiceRole.entities.TenantSecret.filter({ tenant_id: tenantId }, undefined, 1))[0] || null;
}

/** The tenant's key, else the platform-wide Base44 secret ANTHROPIC_API_KEY (if one is set). source: 'tenant' | 'platform' | null. */
export async function anthropicKeyFor(base44, tenantId) {
  let row = null;
  try { row = await findSecret(base44, tenantId); } catch (e) { console.warn('anthropicCredentials: lookup failed', e?.message); }
  if (row?.anthropic_api_key) return { key: row.anthropic_api_key, source: 'tenant', rotated_at: row.anthropic_rotated_at || null };
  const env = typeof Deno !== 'undefined' ? Deno.env.get('ANTHROPIC_API_KEY') : process.env.ANTHROPIC_API_KEY;
  return env ? { key: env, source: 'platform', rotated_at: null } : { key: '', source: null, rotated_at: null };
}

export async function anthropicStatus(base44, tenantId) {
  const k = await anthropicKeyFor(base44, tenantId);
  return { configured: !!k.key, source: k.source, last4: k.source === 'tenant' && k.key ? k.key.slice(-4) : null, rotated_at: k.rotated_at };
}

/** Saves (or with key = '' removes) the tenant key and writes an AuditEvent without the value. */
export async function saveAnthropicKey(base44, tenantId, key, actor) {
  const E = base44.asServiceRole.entities;
  const existing = await findSecret(base44, tenantId);
  const patch = { anthropic_api_key: key || '', anthropic_rotated_at: new Date().toISOString(), anthropic_updated_by_user_id: actor?.actorUserId || undefined };
  if (existing) await E.TenantSecret.update(existing.id, patch);
  else await E.TenantSecret.create({ tenant_id: tenantId, ...patch });
  await E.AuditEvent.create({
    tenant_id: tenantId, actor_user_id: actor?.actorUserId, actor_name: actor?.actorName || 'System', actor_type: actor?.actorType || 'User',
    event_type: key ? 'anthropic_key_saved' : 'anthropic_key_removed',
    before_state: { configured: !!existing?.anthropic_api_key }, after_state: { configured: !!key, last4: key ? key.slice(-4) : null },
    notes: key ? 'Anthropic (Claude) API key stored securely for the KYC Screener.' : 'Anthropic (Claude) API key removed.',
  }).catch((e) => console.warn('anthropicCredentials: audit failed', e?.message));
}
