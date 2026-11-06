// anthropicConnection — per-tenant Claude (Anthropic) connection for the KYC Screener (Tenant Config → Integrations).
// Auth: signed-in Tenant Admin of the tenant, or Vitauri Ops (may pass tenant_id). The key is stored in TenantSecret only and
// is never returned or logged. Actions:
//   status                      -> { configured, source, last4, rotated_at, model }
//   save_key   { api_key, model? } -> checks the key live against the Anthropic Models API, then stores it (audited)
//   test       { model? }       -> live check of the stored key
//   remove_key                  -> clears the tenant key (audited)
//   set_model  { model }        -> Tenant.tm_settings.claude_model (audited)
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.52';
import { asList, errorResponse, httpError } from '../../shared/tmAuth.js';
import { anthropicKeyFor, anthropicStatus, saveAnthropicKey } from '../../shared/anthropicCredentials.js';
import { checkClaudeKey, DEFAULT_CLAUDE_MODEL } from '../../shared/claudeClient.js';

const ADMIN_ROLES = ['Tenant Admin', 'Vitauri Ops'];
const MODEL_RE = /^claude-[a-z0-9.-]{3,60}$/;

export default async function (req) {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me().catch(() => null);
    if (!user) throw httpError(401, 'Unauthorized');
    const role = user.app_role || user.data?.app_role;
    if (!ADMIN_ROLES.includes(role)) throw httpError(403, 'Only a Tenant Admin can manage the Claude connection');
    const body = await req.json().catch(() => ({}));
    const tenantId = role === 'Vitauri Ops' && body.tenant_id ? body.tenant_id : (user.tenant_id || user.data?.tenant_id);
    if (!tenantId) throw httpError(403, 'No tenant associated with this user');
    const E = base44.asServiceRole.entities;
    const tenant = asList(await E.Tenant.filter({ id: tenantId }, undefined, 1))[0];
    if (!tenant) throw httpError(404, 'Tenant not found');
    const actor = { actorUserId: user.id, actorName: user.full_name || user.email, actorType: 'User' };
    const currentModel = String(tenant.tm_settings?.claude_model || DEFAULT_CLAUDE_MODEL);
    const wantModel = (m) => {
      const v = String(m || currentModel).trim();
      if (!MODEL_RE.test(v)) throw httpError(400, 'Model must be a Claude model id, e.g. claude-opus-5-5');
      return v;
    };
    const setModel = async (model) => {
      if (model === currentModel) return;
      await E.Tenant.update(tenantId, { tm_settings: { ...(tenant.tm_settings || {}), claude_model: model } });
      await E.AuditEvent.create({ tenant_id: tenantId, actor_user_id: user.id, actor_name: actor.actorName, actor_type: 'User', event_type: 'claude_model_changed',
        before_state: { model: currentModel }, after_state: { model }, notes: `KYC Screener model set to ${model}.` }).catch(() => {});
    };

    const action = body.action || 'status';
    if (action === 'status') return Response.json({ ...(await anthropicStatus(base44, tenantId)), model: currentModel });

    if (action === 'save_key') {
      const key = String(body.api_key || '').trim();
      if (!/^sk-ant-[A-Za-z0-9_-]{20,}$/.test(key)) throw httpError(400, 'This does not look like an Anthropic API key (it starts with sk-ant-).');
      const model = wantModel(body.model);
      const check = await checkClaudeKey(key, model);
      if (!check.ok) throw httpError(422, `The key was not saved: ${check.error}`);
      await saveAnthropicKey(base44, tenantId, key, actor);
      await setModel(model);
      return Response.json({ saved: true, ...(await anthropicStatus(base44, tenantId)), model, model_name: check.display_name });
    }

    if (action === 'test') {
      const { key } = await anthropicKeyFor(base44, tenantId);
      const model = wantModel(body.model);
      const check = await checkClaudeKey(key, model);
      return Response.json({ ...check, model });
    }

    if (action === 'remove_key') {
      await saveAnthropicKey(base44, tenantId, '', actor);
      return Response.json({ removed: true, ...(await anthropicStatus(base44, tenantId)), model: currentModel });
    }

    if (action === 'set_model') {
      const model = wantModel(body.model);
      const { key } = await anthropicKeyFor(base44, tenantId);
      if (key) { const check = await checkClaudeKey(key, model); if (!check.ok) throw httpError(422, check.error); }
      await setModel(model);
      return Response.json({ model });
    }
    throw httpError(400, 'Unknown action');
  } catch (error) {
    console.error('anthropicConnection error:', error?.message);
    return errorResponse(error);
  }
}
