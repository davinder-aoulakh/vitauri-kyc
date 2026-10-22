// getDiditKybResult — fetch the latest Didit KYB decision and apply it (registry, company documents, company AML, key people).
// Auth, one of:
//   portal:  { access_token, item_id }           -> tenant/outreach from the token; returns status only.
//   user:    { kyb_verification_id }             -> signed-in user with createRunCase, own tenant (Vitauri Ops: any tenant).
// Requires the didit_kyb feature. Didit is only READ here (GET /v3/session/{id}/decision/).
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.52';
import { asList, errorResponse, httpError, loadTenantWithDiditCredentials } from '../../shared/tmAuth.js';
import { authorizeCaller } from '../../shared/customerFile.js';
import { isKybEnabled } from '../../shared/diditWorkflows.js';
import { applyKybDecision, fetchSessionDecision } from '../../shared/diditKyb.js';

export default async function (req) {
  try {
    const base44 = createClientFromRequest(req);
    const body = await req.json().catch(() => ({}));
    const E = base44.asServiceRole.entities;
    let kyb;
    let portal = false;
    let actor;

    if (body.access_token) {
      portal = true;
      const outreach = asList(await E.OutreachRequest.filter({ access_token: String(body.access_token) }, undefined, 1))[0];
      if (!outreach) throw httpError(404, 'Request not found');
      if (outreach.token_expires_at && new Date(outreach.token_expires_at).getTime() < Date.now()) throw httpError(410, 'This link has expired');
      kyb = asList(await E.KybVerification.filter({ tenant_id: outreach.tenant_id, outreach_id: outreach.id, item_id: String(body.item_id || '') }, '-created_date', 1))[0];
      if (!kyb) return Response.json({ ok: true, status: null });
      actor = { actorType: 'System', actorName: 'Client portal' };
    } else {
      if (!body.kyb_verification_id) throw httpError(400, 'kyb_verification_id is required');
      const { tenantId } = await authorizeCaller(base44, req, body, async () => {
        const k = asList(await E.KybVerification.filter({ id: body.kyb_verification_id }, undefined, 1))[0];
        if (!k) throw httpError(404, 'KYB verification not found');
        return k.tenant_id;
      });
      kyb = asList(await E.KybVerification.filter({ tenant_id: tenantId, id: body.kyb_verification_id }, undefined, 1))[0];
      if (!kyb) throw httpError(404, 'KYB verification not found');
      const me = await base44.auth.me().catch(() => null);
      actor = { actorType: 'User', actorName: me?.full_name || me?.email || 'User', actorUserId: me?.id };
    }

    const tenant = await loadTenantWithDiditCredentials(base44, kyb.tenant_id);
    if (!isKybEnabled(tenant)) throw httpError(403, 'Business verification is not enabled');
    if (!kyb.didit_session_id) return Response.json({ ok: true, status: kyb.status || null });

    let decision;
    try {
      decision = await fetchSessionDecision(tenant, kyb.didit_session_id);
    } catch (e) {
      if (e?.status === 404) return Response.json({ ok: true, status: kyb.status || 'Not Started', pending: true });
      throw httpError(502, e?.detail || 'Could not read the Didit decision');
    }
    const updated = await applyKybDecision({ base44, E, tenantId: kyb.tenant_id, actor }, kyb, decision);

    if (portal) return Response.json({ ok: true, status: updated.status });
    return Response.json({
      ok: true, status: updated.status, registry_status: updated.registry_status || null,
      documents: (updated.documents || []).length, aml_total_hits: updated.aml?.total_hits ?? 0, key_people: (updated.key_people_found || []).length,
    });
  } catch (error) {
    console.error('getDiditKybResult error:', error?.message);
    return errorResponse(error);
  }
}
