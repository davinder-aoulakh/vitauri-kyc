// seedOutreachLibrary — imports the starter block library and the three form templates of the outreach pack for the caller's
// tenant (guided conversation outreach). Idempotent by key: blocks and templates that already exist are left alone.
// Auth: Tenant Admin of the tenant, or Vitauri Ops with { tenant_id }. Refuses when the flag outreach_conversation is off.
// Body: { tenant_id? (Ops only), dry_run? }. Audit: outreach.config.seeded.
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.52';
import { asList, errorResponse, httpError } from '../../shared/tmAuth.js';
import { buildSeed, planImport } from '../../shared/outreachSeed.js';
import { OUTREACH_BLOCK_LIBRARY, OUTREACH_FORM_TEMPLATES } from '../../shared/outreachPack.js';
import { conversationOn } from '../../shared/outreachSettings.js';
import { OUTREACH_SEED_ROLES, OPS_ROLE } from '../../shared/outreachAuth.js';
import { emailTemplatesToSeed } from '../../shared/outreachSecondRound.js';

export default async function (req) {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me().catch(() => null);
    if (!user) throw httpError(401, 'Unauthorized');
    const role = user.app_role || user.data?.app_role;
    if (!OUTREACH_SEED_ROLES.includes(role)) throw httpError(403, 'Only a Tenant Admin can import the starter library');
    const body = await req.json().catch(() => ({}));
    const tenantId = role === OPS_ROLE && body.tenant_id ? String(body.tenant_id) : (user.tenant_id || user.data?.tenant_id);
    if (!tenantId) throw httpError(403, 'No tenant associated with this user');
    const E = base44.asServiceRole.entities;
    const tenant = asList(await E.Tenant.filter({ id: tenantId }, undefined, 1))[0];
    if (!tenant) throw httpError(404, 'Tenant not found');
    if (!conversationOn(tenant)) throw httpError(403, 'Guided conversation outreach is not switched on for this tenant');

    const seed = buildSeed(OUTREACH_BLOCK_LIBRARY, OUTREACH_FORM_TEMPLATES);
    const [blocks, templates] = await Promise.all([
      E.OutreachBlock.filter({ tenant_id: tenantId }, undefined, 1000).then(asList),
      E.OutreachFlowTemplate.filter({ tenant_id: tenantId }, undefined, 200).then(asList),
    ]);
    const plan = planImport(seed, { blocks, templates });
    if (body.dry_run) return Response.json({ ok: true, dry_run: true, blocks: plan.createBlocks.length, templates: plan.createTemplates.length, skipped: plan.skipped, unmapped: seed.unmapped });

    const now = new Date().toISOString();
    const by = user.full_name || user.email;
    const stamp = (r) => ({ ...r, tenant_id: tenantId, published_at: now, published_by: by });
    if (plan.createBlocks.length) await E.OutreachBlock.bulkCreate(plan.createBlocks.map(stamp));
    if (plan.createTemplates.length) await E.OutreachFlowTemplate.bulkCreate(plan.createTemplates.map(stamp));
    // phase 9: the five conversation email situations (only those the tenant does not have yet)
    const existingMail = await E.EmailTemplate.filter({ tenant_id: tenantId }, undefined, 200).then(asList).catch(() => []);
    const mailRows = emailTemplatesToSeed(existingMail, tenantId).map((r) => ({ ...r, created_by: by }));
    if (mailRows.length) await E.EmailTemplate.bulkCreate(mailRows).catch((e) => console.warn('email templates seed failed', e?.message));
    await E.AuditEvent.create({
      tenant_id: tenantId, actor_user_id: user.id, actor_name: by, actor_type: 'User', event_type: 'outreach.config.seeded',
      before_state: { blocks: blocks.length, templates: templates.length },
      after_state: { created_blocks: plan.createBlocks.map((b) => b.key), created_templates: plan.createTemplates.map((t) => t.key), skipped: plan.skipped.length, email_templates: mailRows.map((r) => r.situation), pack_version: '2026-11-08' },
      notes: `Starter outreach library imported: ${plan.createBlocks.length} block(s) and ${plan.createTemplates.length} template(s) created, ${plan.skipped.length} already present and left unchanged.`,
    }).catch((e) => console.warn('audit failed', e?.message));
    return Response.json({ ok: true, created_blocks: plan.createBlocks.length, created_templates: plan.createTemplates.length, created_email_templates: mailRows.length, skipped: plan.skipped, unmapped: seed.unmapped });
  } catch (error) {
    console.error('seedOutreachLibrary error:', error?.message);
    return errorResponse(error);
  }
}
