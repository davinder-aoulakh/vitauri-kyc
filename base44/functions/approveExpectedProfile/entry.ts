// approveExpectedProfile — approve or reject a 'proposed' ExpectedProfile.
// Auth: any signed-in app user; the sign-off matrix + risk class decide who may act. Tenant from the authenticated user.
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.52';
import { isTmEnabled } from '../../shared/tmGuards.js';
import { writeAudit } from '../../shared/tmAudit.js';
import { authenticate, errorResponse, httpError, loadTenant, asList } from '../../shared/tmAuth.js';
import { canDecideProfile } from '../../shared/tmProfileAuth.js';
import { updateUserCustomProperties, isPathMissing } from '../../shared/diditTm.js';
import { latestEndpointCheck, isMissingInCheck } from '../../shared/diditEndpointStatus.js';
import { safeRecompute } from '../../shared/tmRisk.js';

const ALL_ROLES = ['Analyst', 'QC Reviewer', 'Compliance Officer', 'Manager', 'Director', 'Compliance Admin', 'Tenant Admin'];

function defaultValidUntil() {
  const d = new Date();
  d.setUTCFullYear(d.getUTCFullYear() + 1);
  return d.toISOString().slice(0, 10);
}

export default async function (req) {
  try {
    const base44 = createClientFromRequest(req);
    const body = await req.json();
    const auth = await authenticate(base44, req, body, { roles: ALL_ROLES, allowApiKey: false });
    const tenantId = auth.tenantId;
    const E = base44.asServiceRole.entities;
    const me = await base44.auth.me();
    const role = me.app_role || me.data?.app_role;

    const { profile_id: profileId, decision } = body;
    const rationale = String(body.rationale || '').trim();
    if (!profileId) throw httpError(400, 'profile_id is required');
    if (!['approve', 'reject'].includes(decision)) throw httpError(400, "decision must be 'approve' or 'reject'");
    if (!rationale) throw httpError(400, 'A rationale is required');

    const tenant = await loadTenant(base44, tenantId);
    if (!isTmEnabled(tenant, 'tm_core')) throw httpError(403, 'Feature tm_core is not enabled');

    const profile = asList(await E.ExpectedProfile.filter({ tenant_id: tenantId, id: profileId }))[0];
    if (!profile) throw httpError(404, 'Profile not found');
    if (profile.status !== 'proposed') throw httpError(409, `Profile is ${profile.status}, not proposed`);

    const client = asList(await E.Client.filter({ tenant_id: tenantId, id: profile.client_id }))[0];
    if (!client) throw httpError(404, 'Client not found');

    const verdict = canDecideProfile({
      role, userId: auth.actorUserId, tenant, riskClass: client.risk_classification, proposedBy: profile.proposed_by_user_id,
    });
    if (!verdict.allowed) throw httpError(403, verdict.reason);

    const nowIso = new Date().toISOString();
    const decisionBase = {
      tenant_id: tenantId, subject_type: 'client', subject_id: client.id, client_id: client.id,
      decision_type: 'profile_approval', rationale, decided_by_user_id: auth.actorUserId, decided_at: nowIso,
      four_eyes_user_id: profile.proposed_by_user_id && profile.proposed_by_user_id !== auth.actorUserId ? profile.proposed_by_user_id : undefined,
      snapshot: { profile_version: profile.version },
    };
    Object.keys(decisionBase).forEach((k) => decisionBase[k] === undefined && delete decisionBase[k]);

    // ── Reject ───────────────────────────────────────────────────────────────
    if (decision === 'reject') {
      await E.ExpectedProfile.update(profile.id, {
        status: 'rejected', rejection_reason: rationale, approved_by_user_id: auth.actorUserId,
        approved_by_name: auth.actorName, approved_at: nowIso,
      });
      await E.Decision.create({ ...decisionBase, outcome: 'rejected' });
      await writeAudit(base44, auth, {
        tenantId, clientId: client.id, eventType: 'expected_profile_rejected',
        before: { profile_id: profile.id, status: 'proposed' }, after: { profile_id: profile.id, status: 'rejected' },
        notes: `Expected profile v${profile.version} rejected: ${rationale}`,
      });
      return Response.json({ ok: true, status: 'rejected' });
    }

    // ── Approve ──────────────────────────────────────────────────────────────
    const prior = asList(await E.ExpectedProfile.filter({ tenant_id: tenantId, client_id: client.id, status: 'approved' }));
    for (const p of prior) {
      if (p.id === profile.id) continue;
      await E.ExpectedProfile.update(p.id, { status: 'superseded' });
      await writeAudit(base44, auth, {
        tenantId, clientId: client.id, eventType: 'expected_profile_superseded',
        before: { profile_id: p.id, status: 'approved' }, after: { profile_id: p.id, status: 'superseded' },
        notes: `Expected profile v${p.version} superseded by v${profile.version}.`,
      });
    }

    const validUntil = body.valid_until || defaultValidUntil();
    await E.ExpectedProfile.update(profile.id, {
      status: 'approved', rationale, valid_from: nowIso.slice(0, 10), valid_until: validUntil,
      approved_by_user_id: auth.actorUserId, approved_by_name: auth.actorName, approved_at: nowIso,
    });
    await E.Client.update(client.id, { current_profile_id: profile.id });
    await E.Decision.create({ ...decisionBase, outcome: 'approved' });
    await writeAudit(base44, auth, {
      tenantId, clientId: client.id, eventType: 'expected_profile_approved',
      before: { profile_id: profile.id, status: 'proposed', previous_profile_id: client.current_profile_id || null },
      after: { profile_id: profile.id, status: 'approved', valid_until: validUntil },
      notes: `Expected profile v${profile.version} approved: ${rationale}`,
    });

    // Push to Didit — failure is recorded, never undoes the approval.
    // If the endpoint is missing on this plan the push is skipped silently (submitToDidit sends the profile per transaction).
    let syncError = null;
    let unsupported = false;
    try {
      const check = await latestEndpointCheck(E, tenantId).catch(() => null);
      if (isMissingInCheck(check, 'userCustomProperties')) unsupported = true;
      else await updateUserCustomProperties(tenant, client.id, {
        profile_version: profile.version,
        profile_currency: profile.currency,
        inbound_max_month: profile.inbound_max_month ?? null,
        inbound_max_count_month: profile.inbound_max_count_month ?? null,
        outbound_max_month: profile.outbound_max_month ?? null,
        outbound_foreign_max_month: profile.outbound_foreign_max_month ?? null,
        cash_max_month: profile.cash_max_month ?? null,
        allowed_countries: profile.allowed_countries || [],
        valid_until: validUntil,
      });
    } catch (e) {
      if (isPathMissing(e)) unsupported = true;
      else syncError = typeof e?.detail === 'string' ? e.detail : JSON.stringify(e?.detail || e?.message || e).slice(0, 500);
    }
    await E.ExpectedProfile.update(profile.id, unsupported
      ? { didit_sync_error: 'not supported on this plan' }
      : syncError
        ? { didit_sync_error: syncError }
        : { didit_synced_at: new Date().toISOString(), didit_sync_error: '' });

    await safeRecompute(base44, { tenantId, tenant, clientId: client.id, trigger: 'profile_approved', actor: auth });

    return Response.json({ ok: true, status: 'approved', didit_sync_error: syncError });
  } catch (error) {
    console.error('approveExpectedProfile error:', error?.message);
    return errorResponse(error);
  }
}