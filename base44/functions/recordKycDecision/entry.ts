// recordKycDecision — record a KYC sign-off as a reproducible Decision (kyc_approval, plus optional aml_assessment).
// Auth: signed-in user with createRunCase; tenant from the user and checked against the case. Requires tm_core.
// Idempotent per (kyc_case_id, outcome). Didit results are only READ from data already stored in Vitauri.
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.52';
import { isTmEnabled } from '../../shared/tmGuards.js';
import { authenticate, errorResponse, httpError, loadTenant, asList } from '../../shared/tmAuth.js';

const CREATE_RUN_CASE = ['Analyst', 'QC Reviewer', 'Compliance Officer', 'Manager', 'Director', 'Compliance Admin', 'Tenant Admin']; // createRunCase
const OUTCOMES = ['approved', 'rejected'];
const AML_OUTCOMES = ['no_concerns', 'concerns_handled_in_tm', 'report_to_fiu'];

async function buildSnapshot(E, tenantId, tenant, kycCase, client) {
  const [assessments, hits, outreach, profiles, links, kybs] = await Promise.all([
    E.RiskAssessment.filter({ tenant_id: tenantId, case_id: kycCase.id }, undefined, 500).then(asList),
    E.ScreeningHit.filter({ tenant_id: tenantId, case_id: kycCase.id }, undefined, 500).then(asList),
    E.OutreachRequest.filter({ tenant_id: tenantId, case_id: kycCase.id }, undefined, 100).then(asList),
    E.ExpectedProfile.filter({ tenant_id: tenantId, client_id: kycCase.client_id, status: 'approved' }, '-version', 1).then(asList),
    E.ClientRelatedPartyLink.filter({ tenant_id: tenantId, client_id: kycCase.client_id }, undefined, 200).then(asList),
    client?.client_type === 'ORG'
      ? E.KybVerification.filter({ tenant_id: tenantId, client_id: kycCase.client_id }, '-created_date', 1).then(asList).catch(() => [])
      : Promise.resolve([]),
  ]);

  const partyIds = [...new Set(links.map((l) => l.related_party_id).filter(Boolean))];
  const parties = partyIds.length
    ? asList(await E.RelatedParty.filter({ tenant_id: tenantId, id: { $in: partyIds } }, undefined, 200)) : [];
  const partyById = new Map(parties.map((p) => [p.id, p]));

  const didit = [];
  for (const req of outreach) {
    for (const item of req.items || []) {
      if (!item.didit_session_id && !item.idv_status) continue;
      didit.push({
        session_id: item.didit_session_id || null,
        idv_status: item.idv_status || null,
        idv_document_type: item.idv_document_type || null,
        idv_issuing_country: item.idv_issuing_country || null,
      });
    }
  }

  return {
    case_type: kycCase.case_type,
    risk_classification: kycCase.risk_classification || null,
    risk_scoring_model: tenant.risk_scoring_model || null,
    risk_assessment: assessments.map((a) => ({
      indicator_id: a.indicator_id, entity_type: a.entity_type || null, entity_id: a.entity_id || null,
      score: a.score ?? null, analyst_override: a.analyst_override ?? null,
    })),
    screening_ids: hits.map((h) => h.id),
    screening: hits.map((h) => ({ id: h.id, status: h.status || null })),
    didit,
    profile_version: profiles[0]?.version,
    customer_risk_score: client?.customer_risk_score ?? null,
    client: {
      business_activity: client?.business_activity || null,
      sector: client?.sector || null,
      country_of_residence: client?.country_of_residence || null,
      registered_country: client?.registered_country || null,
    },
    related_parties: links.map((l) => {
      const p = partyById.get(l.related_party_id);
      return {
        id: l.related_party_id, full_name: p?.full_name || null,
        role: l.role || p?.role_in_relationship || null,
        ownership_percentage: l.ownership_percentage ?? p?.ownership_percentage ?? null,
        verification_status: p?.verification_status || null,
      };
    }),
    ...(kybs[0] ? { kyb: { session_id: kybs[0].didit_session_id || null, status: kybs[0].status || null, registration_number: kybs[0].registry?.registration_number || null, decided_at: kybs[0].decided_at || null } } : {}),
    ai_model: tenant.tm_settings?.ai_model || 'automatic',
  };
}

async function defaultRationale(E, tenantId, kycCase, outcome) {
  if (outcome === 'rejected') return kycCase.sign_off_rejection_reason || 'Rejected at KYC sign-off.';
  const ev = asList(await E.AuditEvent.filter({ tenant_id: tenantId, case_id: kycCase.id, event_type: 'sign_off_approved' }, '-created_date', 1))[0];
  return ev?.notes || 'Approved at KYC sign-off.';
}

async function findDecision(E, tenantId, caseId, decisionType, outcome) {
  return asList(await E.Decision.filter({
    tenant_id: tenantId, subject_type: 'case', subject_id: caseId, decision_type: decisionType, outcome,
  }, '-created_date', 1))[0] || null;
}

export default async function (req) {
  try {
    const base44 = createClientFromRequest(req);
    const body = await req.json();
    const auth = await authenticate(base44, req, body, { roles: CREATE_RUN_CASE, allowApiKey: false });
    const tenantId = auth.tenantId;
    const E = base44.asServiceRole.entities;

    if (!body.kyc_case_id) throw httpError(400, 'kyc_case_id is required');
    const outcome = body.outcome;
    if (!OUTCOMES.includes(outcome)) throw httpError(400, 'outcome must be approved or rejected');
    const aml = body.aml_assessment || null;
    if (aml && !AML_OUTCOMES.includes(aml.outcome)) throw httpError(400, 'Invalid aml_assessment outcome');

    const tenant = await loadTenant(base44, tenantId);
    if (!isTmEnabled(tenant, 'tm_core')) throw httpError(403, 'Feature tm_core is not enabled');

    const kycCase = asList(await E.KycCase.filter({ tenant_id: tenantId, id: body.kyc_case_id }, undefined, 1))[0];
    if (!kycCase || kycCase.tenant_id !== tenantId) throw httpError(404, 'KYC case not found');
    if (outcome === 'approved' && kycCase.status !== 'Approved') throw httpError(409, 'Case is not approved');
    if (outcome === 'rejected' && kycCase.status === 'Approved') throw httpError(409, 'Case is approved');

    const existing = await findDecision(E, tenantId, kycCase.id, 'kyc_approval', outcome);
    const existingAml = aml ? await findDecision(E, tenantId, kycCase.id, 'aml_assessment', aml.outcome) : null;
    if (existing && (!aml || existingAml)) {
      return Response.json({ ok: true, idempotent: true, decision_id: existing.id, aml_decision_id: existingAml?.id || null });
    }

    const client = asList(await E.Client.filter({ tenant_id: tenantId, id: kycCase.client_id }, undefined, 1))[0] || null;
    const snapshot = await buildSnapshot(E, tenantId, tenant, kycCase, client);
    Object.keys(snapshot).forEach((k) => snapshot[k] === undefined && delete snapshot[k]);
    const nowIso = new Date().toISOString();
    const base = {
      tenant_id: tenantId, subject_type: 'case', subject_id: kycCase.id, client_id: kycCase.client_id,
      decided_by_user_id: auth.actorUserId, decided_at: nowIso, snapshot,
    };

    let decision = existing;
    if (!decision) {
      const rationale = String(body.rationale || '').trim() || await defaultRationale(E, tenantId, kycCase, outcome);
      decision = await E.Decision.create({ ...base, decision_type: 'kyc_approval', outcome, rationale });
    }

    let amlDecision = existingAml;
    if (aml && !amlDecision) {
      amlDecision = await E.Decision.create({
        ...base, decision_type: 'aml_assessment', outcome: aml.outcome,
        rationale: String(aml.rationale || '').trim() || `AML assessment at KYC sign-off: ${aml.outcome.replace(/_/g, ' ')}.`,
      });
    }

    await E.AuditEvent.create({
      tenant_id: tenantId, case_id: kycCase.id, client_id: kycCase.client_id,
      actor_user_id: auth.actorUserId, actor_name: auth.actorName, actor_type: auth.actorType,
      event_type: 'kyc_decision_recorded',
      before_state: {},
      after_state: { decision_id: decision.id, outcome, aml_decision_id: amlDecision?.id || null, aml_outcome: aml?.outcome || null },
      notes: `KYC decision recorded: ${outcome}${aml ? `; AML assessment: ${aml.outcome.replace(/_/g, ' ')}` : ''}.`,
    });

    return Response.json({ ok: true, decision_id: decision.id, aml_decision_id: amlDecision?.id || null });
  } catch (error) {
    console.error('recordKycDecision error:', error?.message);
    return errorResponse(error);
  }
}
