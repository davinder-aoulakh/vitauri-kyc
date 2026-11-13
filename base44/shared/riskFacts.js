// riskFacts — loads what Vitauri holds about a case and turns it into per-entity facts (collectSignals).
// Shared by suggestRiskIndicators (which indicators apply) and proposeRiskScores (how to score them).
// Read-only, tenant-checked by the caller; no Didit endpoints are called.
import { asList } from './tmAuth.js';
import { collectSignals } from './riskSignals.js';

const clip = (s, n = 200) => { const t = String(s ?? '').replace(/\s+/g, ' ').trim(); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };

/** Signals for the indicator picker: { signals, relatedParties, links, outreach, hits }. */
export async function loadRiskSignals(E, kycCase, client) {
  const [outreachByCase, outreachByClient, hitsByCase, hitsByClient, links] = await Promise.all([
    E.OutreachRequest.filter({ case_id: kycCase.id }).then(asList).catch(() => []),
    E.OutreachRequest.filter({ client_id: client.id }).then(asList).catch(() => []),
    E.ScreeningHit.filter({ case_id: kycCase.id }).then(asList).catch(() => []),
    E.ScreeningHit.filter({ client_id: client.id }).then(asList).catch(() => []),
    E.ClientRelatedPartyLink.filter({ client_id: client.id }).then(asList).catch(() => []),
  ]);
  const rpIds = [...new Set(links.map((l) => l.related_party_id).filter(Boolean))];
  const [relatedParties, rpHits] = await Promise.all([
    rpIds.length ? E.RelatedParty.filter({ id: { $in: rpIds } }).then(asList).catch(() => []) : [],
    rpIds.length ? E.ScreeningHit.filter({ related_party_id: { $in: rpIds } }).then(asList).catch(() => []) : [],
  ]);
  const uniq = (rows) => [...new Map(rows.filter((r) => r.tenant_id === kycCase.tenant_id).map((r) => [r.id, r])).values()];
  // Outreach for this case, plus standalone client outreach not tied to another case
  const outreach = uniq([...outreachByCase, ...outreachByClient.filter((r) => !r.case_id || r.case_id === kycCase.id)]);
  const hits = uniq([...hitsByCase, ...hitsByClient, ...rpHits]);
  const rps = uniq(relatedParties);
  const signals = collectSignals({ client, kycCase, outreach, hits, relatedParties: rps, links });
  return { signals, relatedParties: rps, links, outreach, hits };
}

/**
 * Extra facts that matter for SCORING (not for selecting indicators): transaction analysis, document reviews, control
 * measures. Added to the client entity of `signals` (mutates and returns it); `signals.used` gets the matching flags.
 */
export async function addScoringFacts(E, kycCase, client, signals) {
  const tenant_id = kycCase.tenant_id;
  const [txns, docs, measures] = await Promise.all([
    E.KycTransactionAnalysis.filter({ tenant_id, case_id: kycCase.id }, '-created_date', 1).then(asList).catch(() => []),
    E.Document.filter({ tenant_id, client_id: client.id }, '-created_date', 100).then(asList).catch(() => []),
    E.ControlMeasure.filter({ tenant_id, case_id: kycCase.id }, undefined, 100).then(asList).catch(() => []),
  ]);
  const c = signals.entities.find((e) => e.key === 'client');
  if (!c) return signals;
  const ta = txns[0];
  if (ta) {
    const cur = ta.currency || 'EUR';
    const parts = [
      ta.avg_inbound_month != null && `average inbound ${cur} ${Math.round(ta.avg_inbound_month).toLocaleString('en-GB')}/month`,
      ta.avg_outbound_month != null && `average outbound ${cur} ${Math.round(ta.avg_outbound_month).toLocaleString('en-GB')}/month`,
      ta.cash_share != null && `cash share ${Math.round(Number(ta.cash_share) * 100)}%`,
      ta.consistency_with_occupation && `consistency with occupation/business: ${ta.consistency_with_occupation}`,
      Array.isArray(ta.countries) && ta.countries.length && `countries: ${ta.countries.slice(0, 8).map((x) => (typeof x === 'string' ? x : x?.country || x?.code)).filter(Boolean).join(', ')}`,
    ].filter(Boolean);
    if (parts.length) c.facts.push({ kind: 'txn_analysis', text: clip(`Transaction analysis (${ta.status || 'draft'}): ${parts.join('; ')}`, 400), source: 'Transaction analysis', cash_share: ta.cash_share != null ? Number(ta.cash_share) : null, consistency: ta.consistency_with_occupation || '' });
    const concl = ta.analyst_conclusion || ta.ai_conclusion;
    if (concl) c.facts.push({ kind: 'txn_analysis', text: clip(`Transaction analysis conclusion: ${typeof concl === 'string' ? concl : JSON.stringify(concl)}`, 300), source: 'Transaction analysis' });
    signals.used.transactions = true;
  }
  const live = docs.filter((d) => !d.is_deleted && d.doc_type !== 'KYC_Report');
  if (live.length) {
    const by = (s) => live.filter((d) => (d.review_status || 'Pending_Review') === s).length;
    const high = live.filter((d) => d.ai_check?.verdict === 'high_risk' && d.review_status !== 'Approved').length;
    c.facts.push({ kind: 'documents', text: `Documents: ${by('Approved')} approved, ${by('Pending_Review')} pending review, ${by('Rejected')} rejected${high ? `; ${high} rated high risk by the document checker and not approved` : ''}`, source: 'Documents' });
    signals.used.documents = live.length;
  }
  if (measures.length) {
    c.facts.push({ kind: 'control_measures', text: clip(`Control measures in place: ${measures.slice(0, 8).map((m) => m.description).join(' | ')}`, 400), source: 'Control measures' });
    signals.used.control_measures = measures.length;
  }
  return signals;
}
