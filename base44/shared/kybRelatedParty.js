// Didit KYB: apply a related party's (UBO/director) own Didit ID verification to the RelatedParty — never to the company Client.
// Used by getDiditSessionResult and diditWebhook only when the OutreachRequest carries related_party_id.
import { asList } from './tmAuth.js';

const STATUS = { Pass: 'Verified', Fail: 'Rejected' };

function guessSource(text) {
  const t = String(text || '').toLowerCase();
  if (t.includes('pep') || t.includes('politically')) return 'PEP_List';
  if (/\bun\b/.test(t) || t.includes('united nations')) return 'Sanctions_UN';
  if (t.includes('sanction') || t.includes('ofac') || /\beu\b/.test(t)) return 'Sanctions_EU';
  if (t.includes('adverse') || t.includes('media')) return 'Adverse_Media';
  return 'Internal_Flag';
}

/**
 * idvFields: output of diditDecision.extractIdvFields. amlScreenings: decision.aml_screenings (V3 plural array).
 * Returns { related_party_id, verification_status } or null when the party is not found in the tenant.
 */
export async function applyRelatedPartyIdv(base44, { tenantId, outreach, sessionId, idvFields, amlScreenings, actorName = 'Didit IDV' }) {
  const E = base44.asServiceRole.entities;
  const rp = asList(await E.RelatedParty.filter({ tenant_id: tenantId, id: outreach.related_party_id }, undefined, 1))[0];
  if (!rp) return null;

  const patch = {};
  const fill = { date_of_birth: idvFields?.idv_extracted_dob, nationality: idvFields?.idv_extracted_nationality, id_number: idvFields?.idv_document_number, id_expiry_date: idvFields?.idv_document_expiry, id_type: idvFields?.idv_document_type };
  for (const [k, v] of Object.entries(fill)) if (v && !rp[k]) patch[k] = String(v);
  const status = STATUS[idvFields?.idv_status] || (idvFields?.idv_status ? 'Pending_Verification' : null);
  if (status && rp.verification_status !== status) {
    patch.verification_status = status;
    patch.verification_notes = `Didit identity verification ${idvFields.idv_status} (session ${String(sessionId || '').slice(0, 8)}).`;
    if (status === 'Verified') patch.verified_at = new Date().toISOString();
  }
  if (Object.keys(patch).length) await E.RelatedParty.update(rp.id, patch);

  // AML hits for this person (ScreeningHit.case_id is required, so only when the request belongs to a case).
  let created = 0;
  if (outreach.case_id) {
    const existing = asList(await E.ScreeningHit.filter({ tenant_id: tenantId, case_id: outreach.case_id, related_party_id: rp.id }, undefined, 200));
    for (const a of Array.isArray(amlScreenings) ? amlScreenings : []) {
      for (const h of a?.hits || []) {
        if (!h?.id || existing.some((x) => x.hit_details?.didit_hit_id === h.id)) continue;
        const score = Math.round(h.match_score ?? (h.score != null ? (h.score <= 1 ? h.score * 100 : h.score) : 50));
        await E.ScreeningHit.create({
          tenant_id: tenantId, case_id: outreach.case_id, client_id: outreach.client_id, related_party_id: rp.id,
          entity_name: rp.full_name, entity_type: 'Related_Party', source: guessSource((h.datasets || []).join(' ')),
          hit_name: h.caption || 'AML match', confidence_score: score, status: 'New',
          hit_details: { didit_hit_id: h.id, provider: 'Didit', datasets: h.datasets || [], match_score: h.match_score ?? null, risk_score: h.risk_score ?? null, review_status: h.review_status || null, didit_session_id: sessionId },
          ai_rationale: `Didit AML for related party ${rp.full_name}: ${h.caption || 'match'} at ${score}% match.`,
        }).then(() => { created += 1; }).catch(() => {});
      }
    }
  }

  if (Object.keys(patch).length || created) {
    await E.AuditEvent.create({
      tenant_id: tenantId, client_id: outreach.client_id, case_id: outreach.case_id || undefined, actor_type: 'System', actor_name: actorName,
      event_type: 'related_party_idv_applied',
      before_state: { verification_status: rp.verification_status || null },
      after_state: { related_party_id: rp.id, verification_status: patch.verification_status || rp.verification_status || null, fields: Object.keys(patch), aml_hits_created: created },
      notes: `Didit ID verification for related party ${rp.full_name}: ${idvFields?.idv_status || 'pending'}.`,
    }).catch(() => {});
  }
  return { related_party_id: rp.id, verification_status: patch.verification_status || rp.verification_status || null };
}
