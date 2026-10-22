// syncEdrOutcome — write the outcome of an event-driven review back to its TM case (timeline only; TmCase status untouched).
// Auth: signed-in user with createRunCase (tenant from the user), OR an internal call with no user (tenant from the KycCase).
// Runs once per case: skipped unless the case has tm_case_id, is Approved/Rejected and tm_outcome_synced_at is empty. Requires tm_core.
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.52';
import { isTmEnabled } from '../../shared/tmGuards.js';
import { authenticate, errorResponse, httpError, loadTenant, asList } from '../../shared/tmAuth.js';
import { writeAudit } from '../../shared/tmAudit.js';
import { safeRecompute } from '../../shared/tmRisk.js';

const CREATE_RUN_CASE = ['Analyst', 'QC Reviewer', 'Compliance Officer', 'Manager', 'Director', 'Compliance Admin', 'Tenant Admin']; // createRunCase
const FINAL = { Approved: 'approved', Rejected: 'rejected' };

export default async function (req) {
  try {
    const base44 = createClientFromRequest(req);
    const body = await req.json().catch(() => ({}));
    if (!body.kyc_case_id) throw httpError(400, 'kyc_case_id is required');
    const E = base44.asServiceRole.entities;

    const user = await base44.auth.me().catch(() => null);
    let auth;
    let kycCase;
    if (user) {
      auth = await authenticate(base44, req, body, { roles: CREATE_RUN_CASE, allowApiKey: false });
      kycCase = asList(await E.KycCase.filter({ tenant_id: auth.tenantId, id: body.kyc_case_id }, undefined, 1))[0];
    } else {
      kycCase = asList(await E.KycCase.filter({ id: body.kyc_case_id }, undefined, 1))[0];
      auth = { mode: 'system', tenantId: kycCase?.tenant_id, actorType: 'System', actorName: 'System', actorUserId: undefined };
    }
    if (!kycCase?.tenant_id || kycCase.tenant_id !== auth.tenantId) throw httpError(404, 'KYC case not found');
    const tenantId = auth.tenantId;

    const tenant = await loadTenant(base44, tenantId);
    if (!isTmEnabled(tenant, 'tm_core')) throw httpError(403, 'Feature tm_core is not enabled');

    const outcome = FINAL[kycCase.status];
    if (!kycCase.tm_case_id) return Response.json({ ok: true, skipped: 'Case is not linked to a TM case' });
    if (!outcome) return Response.json({ ok: true, skipped: 'Case is not approved or rejected' });
    if (kycCase.tm_outcome_synced_at) return Response.json({ ok: true, skipped: 'Outcome already synced' });

    const tmCase = asList(await E.TmCase.filter({ tenant_id: tenantId, id: kycCase.tm_case_id }, undefined, 1))[0];
    if (!tmCase || tmCase.tenant_id !== tenantId) throw httpError(404, 'TM case not found');

    let name = auth.actorName;
    if (outcome === 'approved' && kycCase.sign_off_approved_by) {
      const approver = asList(await E.User.filter({ id: kycCase.sign_off_approved_by }, undefined, 1))[0];
      if (approver && (approver.tenant_id || approver.data?.tenant_id) === tenantId) name = approver.full_name || approver.email || name;
    }

    const nowIso = new Date().toISOString();
    const entries = [{
      at: nowIso, kind: 'edr_outcome', by: auth.actorName, ref_id: kycCase.id,
      text: `Event-driven review ${outcome} by ${name}: ${kycCase.risk_classification || 'no risk classification'}`,
    }];

    let profile = null;
    if (kycCase.profile_proposal_id) {
      profile = asList(await E.ExpectedProfile.filter({ tenant_id: tenantId, id: kycCase.profile_proposal_id }, undefined, 1))[0] || null;
      if (profile) {
        entries.push({
          at: nowIso, kind: 'profile_proposed', by: auth.actorName, ref_id: profile.id,
          text: `Expected profile v${profile.version} proposed from this review (${profile.status}).`,
        });
      }
    }

    await E.TmCase.update(tmCase.id, { timeline: [...(tmCase.timeline || []), ...entries] });

    const risk = await safeRecompute(base44, { tenantId, tenant, clientId: kycCase.client_id, trigger: 'edr_outcome', actor: auth });

    await E.KycCase.update(kycCase.id, { tm_outcome_synced_at: nowIso });

    await writeAudit(base44, auth, {
      tenantId, clientId: kycCase.client_id, eventType: 'edr_outcome_synced',
      before: { tm_outcome_synced_at: null },
      after: { kyc_case_id: kycCase.id, tm_case_id: tmCase.id, outcome, profile_id: profile?.id || null, risk_score: risk?.score ?? null, tm_outcome_synced_at: nowIso },
      notes: `${entries[0].text} (recorded on TM case ${tmCase.case_ref || tmCase.id}).`,
    });

    return Response.json({ ok: true, tm_case_id: tmCase.id, outcome, synced_at: nowIso, risk: risk ? { score: risk.score, band: risk.band } : null });
  } catch (error) {
    console.error('syncEdrOutcome error:', error?.message);
    return errorResponse(error);
  }
}
