// qcData — loads everything the QC engine reads for a case (read-only, service role, tenant-scoped) and hashes it.
// Shared by runCaseQc (the check) and caseSignoffAction (the gate: a passed QC is only valid for the same input hash).
import { qcInputString } from './qcRules.js';

const asList = (r) => (Array.isArray(r) ? r : r?.items || []);
const safe = (p) => p.then(asList).catch(() => []);

export async function sha256Hex(input) {
  const bytes = typeof input === 'string' ? new TextEncoder().encode(input) : input;
  const h = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function loadQcData(E, tenantId, kycCase, client = null) {
  const t = { tenant_id: tenantId };
  const [cl, links, outreach, caseHits, documents, kybs, txns, controlMeasures, riskAssessments, reports] = await Promise.all([
    client ? Promise.resolve([client]) : safe(E.Client.filter({ ...t, id: kycCase.client_id }, undefined, 1)),
    safe(E.ClientRelatedPartyLink.filter({ ...t, client_id: kycCase.client_id }, undefined, 100)),
    safe(E.OutreachRequest.filter({ ...t, case_id: kycCase.id }, '-created_date', 30)),
    safe(E.ScreeningHit.filter({ ...t, client_id: kycCase.client_id }, '-created_date', 300)),
    safe(E.Document.filter({ ...t, client_id: kycCase.client_id }, '-created_date', 200)),
    safe(E.KybVerification.filter({ ...t, client_id: kycCase.client_id }, '-created_date', 5)),
    safe(E.KycTransactionAnalysis.filter({ ...t, case_id: kycCase.id }, '-created_date', 3)),
    safe(E.ControlMeasure.filter({ ...t, case_id: kycCase.id }, undefined, 200)),
    safe(E.RiskAssessment.filter({ ...t, case_id: kycCase.id }, undefined, 300)),
    safe(E.KycReport.filter({ ...t, case_id: kycCase.id }, '-version_number', 10)),
  ]);
  const rpIds = links.map((l) => l.related_party_id).filter(Boolean);
  const relatedParties = rpIds.length ? await safe(E.RelatedParty.filter({ ...t, id: { $in: rpIds } }, undefined, 100)) : [];
  const kyb = kybs.find((k) => k.case_id === kycCase.id) || kybs[0] || null;
  const data = {
    kycCase, client: cl[0] || null, links, relatedParties, outreach,
    hits: caseHits.filter((h) => !h.is_monitoring_alert && (!h.case_id || h.case_id === kycCase.id)),
    documents: documents.filter((d) => !d.is_deleted), kyb,
    txnAnalysis: txns[0] || null, controlMeasures, riskAssessments,
    report: reports.find((r) => r.status !== 'Superseded' && !r.frozen_at) || null,
  };
  return data;
}

export async function qcInputHash(data) {
  return sha256Hex(qcInputString(data));
}
