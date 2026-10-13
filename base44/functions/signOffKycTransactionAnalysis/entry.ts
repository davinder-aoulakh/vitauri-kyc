// signOffKycTransactionAnalysis — analyst sign-off of a draft KYC transaction analysis.
// Authorisation follows the tenant sign-off matrix for the KycCase risk class (same rules as profile approvals).
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.52';
import { isTmEnabled } from '../../shared/tmGuards.js';
import { writeAudit } from '../../shared/tmAudit.js';
import { authenticate, errorResponse, httpError, loadTenant, asList } from '../../shared/tmAuth.js';
import { canDecideProfile } from '../../shared/tmProfileAuth.js';

const CREATE_RUN_CASE = ['Analyst', 'QC Reviewer', 'Compliance Officer', 'Manager', 'Director', 'Compliance Admin', 'Tenant Admin']; // createRunCase

export default async function (req: Request) {
  try {
    const base44 = createClientFromRequest(req);
    const body = await req.json();
    const auth = await authenticate(base44, req, body, { roles: CREATE_RUN_CASE, allowApiKey: false });
    const tenantId = auth.tenantId;
    const E = base44.asServiceRole.entities;

    if (!body.analysis_id) throw httpError(400, 'analysis_id is required');
    const conclusion = String(body.analyst_conclusion || '').trim();
    if (!conclusion) throw httpError(400, 'analyst_conclusion is required');

    const tenant = await loadTenant(base44, tenantId);
    if (!isTmEnabled(tenant, 'tm_kyc_analysis')) throw httpError(403, 'Feature tm_kyc_analysis is not enabled');

    const analysis = asList(await E.KycTransactionAnalysis.filter({ tenant_id: tenantId, id: body.analysis_id }))[0];
    if (!analysis) throw httpError(404, 'Analysis not found');
    if (analysis.status === 'signed_off') throw httpError(409, 'Analysis is already signed off');

    const kycCase = asList(await E.KycCase.filter({ tenant_id: tenantId, id: analysis.case_id }))[0];
    if (!kycCase || kycCase.client_id !== analysis.client_id) throw httpError(404, 'Case not found');

    const me = await base44.auth.me();
    const role = me?.app_role || me?.data?.app_role;
    const risk = kycCase.risk_classification;
    const decision = canDecideProfile({ role, userId: auth.actorUserId, tenant, riskClass: risk, proposedBy: analysis.run_by_user_id });
    if (!decision.allowed) throw httpError(403, decision.reason || 'Not authorised to sign off at this risk level');

    const now = new Date().toISOString();
    const updated = await E.KycTransactionAnalysis.update(analysis.id, {
      analyst_conclusion: conclusion, status: 'signed_off',
      signed_off_by_user_id: auth.actorUserId, signed_off_by_name: auth.actorName, signed_off_at: now,
    });

    await writeAudit(base44, auth, {
      tenantId, clientId: analysis.client_id, eventType: 'kyc_txn_analysis_signed_off',
      before: { status: analysis.status },
      after: { status: 'signed_off', analysis_id: analysis.id, risk_class: risk || 'Medium' },
      notes: `KYC transaction analysis signed off for case ${kycCase.id} (risk ${risk || 'Medium'}).`,
    });

    return Response.json({ ok: true, analysis: updated });
  } catch (error: any) {
    console.error('signOffKycTransactionAnalysis error:', error?.message);
    return errorResponse(error);
  }
}