// docCheckSettings — per-tenant switch of the AI Document Checker: may it approve documents that have no red flag?
// Body: { action: 'status' } | { action: 'set', auto_approve: boolean }.
// Auth: signed-in user; 'set' only for a Tenant Admin of the tenant (Vitauri Ops may pass tenant_id). Default is OFF.
// The switch is stored in Tenant.tm_settings.doc_check_auto_approve; every change writes an AuditEvent.
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.52';
import { asList, errorResponse, httpError } from '../../shared/tmAuth.js';

export default async function (req) {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me().catch(() => null);
    if (!user) throw httpError(401, 'Unauthorized');
    const role = user.app_role || user.data?.app_role;
    const body = await req.json().catch(() => ({}));
    const tenantId = role === 'Vitauri Ops' && body.tenant_id ? String(body.tenant_id) : (user.tenant_id || user.data?.tenant_id);
    if (!tenantId) throw httpError(403, 'No tenant associated with this user');
    const E = base44.asServiceRole.entities;
    const tenant = asList(await E.Tenant.filter({ id: tenantId }, undefined, 1))[0];
    if (!tenant) throw httpError(404, 'Tenant not found');
    const current = tenant.tm_settings?.doc_check_auto_approve === true;

    if ((body.action || 'status') === 'status') return Response.json({ ok: true, auto_approve: current, can_edit: ['Tenant Admin', 'Vitauri Ops'].includes(role) });
    if (body.action !== 'set') throw httpError(400, 'Unknown action');
    if (!['Tenant Admin', 'Vitauri Ops'].includes(role)) throw httpError(403, 'Only a Tenant Admin can change this setting');
    if (typeof body.auto_approve !== 'boolean') throw httpError(400, 'auto_approve must be true or false');
    if (body.auto_approve !== current) {
      await E.Tenant.update(tenantId, { tm_settings: { ...(tenant.tm_settings || {}), doc_check_auto_approve: body.auto_approve } });
      await E.AuditEvent.create({
        tenant_id: tenantId, actor_user_id: user.id, actor_name: user.full_name || user.email, actor_type: 'User', event_type: 'doc_check_auto_approve_changed',
        before_state: { doc_check_auto_approve: current }, after_state: { doc_check_auto_approve: body.auto_approve },
        notes: `AI Document Checker auto-approval switched ${body.auto_approve ? 'ON' : 'OFF'}: documents without red flags are ${body.auto_approve ? 'approved by the checker' : 'left for an analyst to approve'}.`,
      }).catch((e) => console.warn('audit failed', e?.message));
    }
    return Response.json({ ok: true, auto_approve: body.auto_approve });
  } catch (error) {
    console.error('docCheckSettings error:', error?.message);
    return errorResponse(error);
  }
}
