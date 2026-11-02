// acceptKybReview — a Vitauri reviewer accepts a Didit KYB that Didit holds "In Review" only for its key-people check,
// once every UBO/director is Verified in Vitauri. Didit's own status is not changed and no Didit endpoint is called.
// Auth: signed-in user of the tenant with approval authority. Body: { kyb_verification_id, reason }.
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.52';
import { asList, errorResponse, httpError } from '../../shared/tmAuth.js';
import { acceptReadiness, openChecks } from '../../shared/kybReview.js';

// Mirrors approveMedium in src/lib/permissions.js
const REVIEW_ROLES = ['Manager', 'Director', 'Compliance Officer', 'Compliance Admin', 'Tenant Admin'];

export default async function (req) {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) throw httpError(401, 'Unauthorized');
    const tenantId = user.tenant_id || user.data?.tenant_id;
    const role = user.app_role || user.data?.app_role;
    if (!REVIEW_ROLES.includes(role)) throw httpError(403, 'You do not have authority to accept a business verification');

    let body: any = {};
    try { body = await req.json(); } catch { body = {}; }
    const reason = String(body.reason || '').trim().slice(0, 2000);
    if (!body.kyb_verification_id) throw httpError(400, 'kyb_verification_id is required');
    if (reason.length < 10) throw httpError(400, 'Give a reason of at least 10 characters');

    const E = base44.asServiceRole.entities;
    const kyb = asList(await E.KybVerification.filter({ id: body.kyb_verification_id }))[0];
    if (!kyb || kyb.tenant_id !== tenantId) throw httpError(404, 'Business verification not found');

    const links = asList(await E.ClientRelatedPartyLink.filter({ tenant_id: tenantId, client_id: kyb.client_id }));
    const ids = [...new Set(links.map((l) => l.related_party_id).filter(Boolean))];
    const parties = ids.length ? asList(await E.RelatedParty.filter({ tenant_id: tenantId, id: { $in: ids } })) : [];
    const byId = new Map(parties.map((p) => [p.id, p]));
    const people = links.map((l) => {
      const p = byId.get(l.related_party_id);
      return p ? { full_name: p.full_name, role: l.role || p.role_in_relationship, verification_status: p.verification_status } : null;
    }).filter(Boolean);

    const ready = acceptReadiness(kyb, people);
    if (!ready.ok) throw httpError(400, `Cannot accept yet: ${ready.reasons.join('; ')}`);

    const open = openChecks(kyb).map((c) => `${c.label}: ${c.status}`);
    const review = {
      decision: 'accepted', reason, by_user_id: user.id, by_name: user.full_name || user.email,
      at: new Date().toISOString(), didit_status_at_decision: kyb.status, open_checks: open,
    };
    await E.KybVerification.update(kyb.id, { vitauri_review: review });
    await E.AuditEvent.create({
      tenant_id: tenantId, client_id: kyb.client_id, case_id: kyb.kyc_case_id || undefined,
      actor_user_id: user.id, actor_name: user.full_name, actor_type: 'User', event_type: 'kyb_review_accepted',
      before_state: { didit_status: kyb.status, vitauri_review: kyb.vitauri_review || null },
      after_state: { didit_status: kyb.status, open_checks: open, key_people_verified: people.map((p) => p.full_name) },
      notes: `Business verification accepted in Vitauri while Didit is ${kyb.status} (${open.join(', ')}). Reason: ${reason}`,
    });
    return Response.json({ ok: true, vitauri_review: review });
  } catch (error) {
    console.error('acceptKybReview error:', error?.message);
    return errorResponse(error);
  }
}
