// manageOutreachConfig — Tenant Config of the guided conversation outreach: blocks, templates, settings, and (Vitauri Ops only)
// the company-registry integration. Refuses when the flag outreach_conversation is off for the tenant.
// Auth: signed-in user; tenant from the user (Vitauri Ops may pass tenant_id). Body: { action, ... }
//   list                                         -> blocks, templates, settings, registry status (any outreach role, Ops)
//   save_block { key?, block }                   -> creates or updates the draft of a block (version + 1 over the published one)
//   publish_block { key }                        -> the draft becomes the published version
//   save_template { key?, template }             -> draft of a template;  publish_template { key }
//   toggle_template_item { key, block_key, active } -> per-template Active switch (on the draft)
//   save_settings { settings }                   -> Tenant.outreach_settings through cleanSettings
//   integration_status                           -> registry in use, KvK mode, key set + last 4 (Vitauri Ops)
//   set_integration { kvk_mode?, kvk_api_key? }  -> Vitauri Ops only; the key is never returned
// Writes (config roles: Tenant Admin, Compliance Admin) audit outreach.config.changed; integration changes audit
// outreach.integration.changed without the key value.
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.52';
import { asList, errorResponse, httpError } from '../../shared/tmAuth.js';
import { conversationOn, cleanSettings, outreachSettings, registryProvider } from '../../shared/outreachSettings.js';
import { versionsByKey, nextVersion, cleanBlockInput, cleanTemplateInput, draftFrom, pinItems, cleanIntegration, BLOCK_FIELDS, TEMPLATE_FIELDS } from '../../shared/outreachConfig.js';
import { OUTREACH_CONFIG_ROLES, OUTREACH_WORK_ROLES, OPS_ROLE } from '../../shared/outreachAuth.js';

const KEY_RE = /^[a-z][a-z0-9_]{1,59}$/;

export default async function (req) {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me().catch(() => null);
    if (!user) throw httpError(401, 'Unauthorized');
    const role = user.app_role || user.data?.app_role;
    const isOps = role === OPS_ROLE;
    const body = await req.json().catch(() => ({}));
    const tenantId = isOps && body.tenant_id ? String(body.tenant_id) : (user.tenant_id || user.data?.tenant_id);
    if (!tenantId) throw httpError(403, 'No tenant associated with this user');
    if (!isOps && !OUTREACH_WORK_ROLES.includes(role)) throw httpError(403, 'Forbidden');
    const E = base44.asServiceRole.entities;
    const tenant = asList(await E.Tenant.filter({ id: tenantId }, undefined, 1))[0];
    if (!tenant) throw httpError(404, 'Tenant not found');
    const action = body.action || 'list';
    const actor = { id: user.id, name: user.full_name || user.email };
    const now = () => new Date().toISOString();
    const audit = (event_type, notes, before = {}, after = {}) => E.AuditEvent.create({
      tenant_id: tenantId, actor_user_id: actor.id, actor_name: actor.name, actor_type: 'User', event_type, before_state: before, after_state: after, notes: String(notes).slice(0, 1000),
    }).catch((e) => console.warn('audit failed', e?.message));
    const secretRow = async () => asList(await E.TenantSecret.filter({ tenant_id: tenantId }, undefined, 1))[0] || null;
    const integration = async () => {
      const s = await secretRow();
      const mode = s?.kvk_mode || 'off';
      return {
        registry: registryProvider(mode).label, kvk_mode: mode, kvk_key_set: !!s?.kvk_api_key, kvk_key_last4: s?.kvk_api_key ? String(s.kvk_api_key).slice(-4) : null,
        changed_at: s?.outreach_rotated_at || null, didit_key_set: !!s?.didit_api_key,
      };
    };

    // The Ops console works on the integration even while the flag is off (to prepare a tenant before switching it on).
    if (action === 'integration_status' || action === 'set_integration') {
      if (!isOps) throw httpError(403, 'Only Vitauri Ops can see or change outreach integrations');
      if (action === 'integration_status') return Response.json({ ok: true, flag_on: conversationOn(tenant), ...(await integration()) });
      const row = await secretRow();
      const { patch, errors } = cleanIntegration({ kvk_mode: body.kvk_mode, kvk_api_key: body.kvk_api_key }, { hasKey: !!row?.kvk_api_key });
      if (errors.length) throw httpError(400, errors.join('; '));
      const before = await integration();
      const write = { ...patch };
      if (write.kvk_mode_if_live) { if (row?.kvk_mode === 'live') write.kvk_mode = 'off'; delete write.kvk_mode_if_live; }
      if (!Object.keys(write).length) return Response.json({ ok: true, ...before });
      Object.assign(write, { outreach_rotated_at: now(), outreach_updated_by_user_id: actor.id });
      if (row) await E.TenantSecret.update(row.id, write); else await E.TenantSecret.create({ tenant_id: tenantId, ...write });
      const after = await integration();
      await audit('outreach.integration.changed',
        `Outreach integration changed: KvK mode ${before.kvk_mode} -> ${after.kvk_mode}${write.kvk_api_key !== undefined ? (write.kvk_api_key ? ', KvK key saved' : ', KvK key removed') : ''}. Applies to new requests only.`,
        { kvk_mode: before.kvk_mode, kvk_key_set: before.kvk_key_set }, { kvk_mode: after.kvk_mode, kvk_key_set: after.kvk_key_set, kvk_key_last4: after.kvk_key_last4 });
      return Response.json({ ok: true, ...after });
    }

    if (!conversationOn(tenant)) throw httpError(403, 'Guided conversation outreach is not switched on for this tenant');
    const canEdit = OUTREACH_CONFIG_ROLES.includes(role) || isOps;
    const [blocks, templates] = await Promise.all([
      E.OutreachBlock.filter({ tenant_id: tenantId }, undefined, 2000).then(asList),
      E.OutreachFlowTemplate.filter({ tenant_id: tenantId }, undefined, 500).then(asList),
    ]);

    if (action === 'list') {
      const s = await secretRow();
      const reg = registryProvider(s?.kvk_mode || 'off');
      return Response.json({ ok: true, can_edit: canEdit, blocks, templates, settings: outreachSettings(tenant), registry: { label: reg.label, didit_key_set: !!s?.didit_api_key } });
    }
    if (!canEdit) throw httpError(403, 'Only a Tenant Admin or Compliance Admin can change the outreach configuration');
    const blockKeys = [...new Set(blocks.map((b) => b.key))];

    if (action === 'save_block' || action === 'save_template') {
      const isBlock = action === 'save_block';
      const Ent = isBlock ? E.OutreachBlock : E.OutreachFlowTemplate;
      const rows = isBlock ? blocks : templates;
      const input = (isBlock ? body.block : body.template) || {};
      const key = String(body.key || input.key || '').trim();
      if (!KEY_RE.test(key)) throw httpError(400, 'key: lower-case letters, digits and _ (2 to 60 characters, starting with a letter)');
      const { fields, errors } = isBlock ? cleanBlockInput(input, [...new Set([...blockKeys, key])]) : cleanTemplateInput(input, blockKeys);
      if (errors.length) throw httpError(400, errors.join('; '));
      const v = versionsByKey(rows)[key];
      const before = v?.draft || v?.published || null;
      let saved;
      if (v?.draft) saved = await Ent.update(v.draft.id, fields).then(() => ({ ...v.draft, ...fields }));
      else {
        const base = v?.published ? draftFrom(v.published, isBlock ? BLOCK_FIELDS : TEMPLATE_FIELDS, nextVersion(rows, key)) : { key, version: 1, status: 'draft', ...(isBlock ? { active_default: true } : {}) };
        if (!v && isBlock && !fields.label) throw httpError(400, 'label: required');
        if (!v && !isBlock && !fields.name) throw httpError(400, 'name: required');
        saved = await Ent.create({ ...base, ...fields, tenant_id: tenantId });
      }
      const changed = Object.keys(fields).filter((k) => JSON.stringify(fields[k]) !== JSON.stringify(before?.[k]));
      await audit('outreach.config.changed', `${isBlock ? 'Block' : 'Template'} "${key}" draft v${saved.version} saved${changed.length ? `: ${changed.join(', ')}` : ''}.`,
        { kind: isBlock ? 'block' : 'template', key, version: before?.version || null, status: before?.status || null },
        { kind: isBlock ? 'block' : 'template', key, version: saved.version, status: 'draft', fields: changed });
      return Response.json({ ok: true, row: saved });
    }

    if (action === 'publish_block' || action === 'publish_template') {
      const isBlock = action === 'publish_block';
      const Ent = isBlock ? E.OutreachBlock : E.OutreachFlowTemplate;
      const key = String(body.key || '');
      const v = versionsByKey(isBlock ? blocks : templates)[key];
      if (!v?.draft) throw httpError(409, 'There is no draft to publish');
      const patch = { status: 'published', published_at: now(), published_by: actor.name };
      if (!isBlock) {
        const { errors } = cleanTemplateInput({ items: v.draft.items || [] }, blockKeys);
        if (errors.length) throw httpError(400, errors.join('; '));
        const published = Object.fromEntries(Object.entries(versionsByKey(blocks)).map(([k, x]) => [k, x.published]).filter(([, p]) => p));
        const missing = (v.draft.items || []).filter((it) => !published[it.block_key]).map((it) => it.block_key);
        if (missing.length) throw httpError(409, `Publish these blocks first: ${missing.join(', ')}`);
        patch.items = pinItems(v.draft.items || [], published);
      }
      await Ent.update(v.draft.id, patch);
      await audit('outreach.config.changed', `${isBlock ? 'Block' : 'Template'} "${key}" published as version ${v.draft.version}. Requests already sent keep their version.`,
        { kind: isBlock ? 'block' : 'template', key, version: v.published?.version || null }, { kind: isBlock ? 'block' : 'template', key, version: v.draft.version, status: 'published' });
      return Response.json({ ok: true, key, version: v.draft.version });
    }

    if (action === 'toggle_template_item') {
      const key = String(body.key || '');
      const v = versionsByKey(templates)[key];
      if (!v) throw httpError(404, 'Template not found');
      const src = v.draft || v.published;
      const items = (src.items || []).map((it) => (it.block_key === body.block_key ? { ...it, active: body.active === true } : it));
      if (!items.some((it) => it.block_key === body.block_key)) throw httpError(404, 'Block is not on this template');
      let row;
      if (v.draft) { await E.OutreachFlowTemplate.update(v.draft.id, { items }); row = { ...v.draft, items }; }
      else row = await E.OutreachFlowTemplate.create({ ...draftFrom(v.published, TEMPLATE_FIELDS, nextVersion(templates, key)), items, tenant_id: tenantId });
      await audit('outreach.config.changed', `Template "${key}": block "${body.block_key}" switched ${body.active === true ? 'on' : 'off'} (draft v${row.version}).`,
        { kind: 'template', key, block_key: body.block_key }, { kind: 'template', key, block_key: body.block_key, active: body.active === true, version: row.version });
      return Response.json({ ok: true, row });
    }

    if (action === 'save_settings') {
      const before = outreachSettings(tenant);
      const { settings, errors } = cleanSettings(body.settings || {});
      if (errors.length) throw httpError(400, `Invalid value for: ${errors.join(', ')}`);
      await E.Tenant.update(tenantId, { outreach_settings: settings });
      const changed = Object.keys(settings).filter((k) => JSON.stringify(settings[k]) !== JSON.stringify(before[k]));
      await audit('outreach.config.changed', `Outreach settings saved${changed.length ? `: ${changed.join(', ')}` : ' (no change)'}.`,
        { kind: 'settings', ...Object.fromEntries(changed.map((k) => [k, before[k]])) }, { kind: 'settings', ...Object.fromEntries(changed.map((k) => [k, settings[k]])) });
      return Response.json({ ok: true, settings });
    }

    throw httpError(400, `Unknown action ${action}`);
  } catch (error) {
    console.error('manageOutreachConfig error:', error?.message);
    return errorResponse(error);
  }
}
