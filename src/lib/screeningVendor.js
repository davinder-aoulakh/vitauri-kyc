/**
 * Screening Vendor Abstraction Layer
 * Screens an entity against real global watchlists via Didit's standalone
 * AML Screening API (server-side call — see base44/functions/screenEntityAml,
 * which holds the tenant's Didit API key and does the actual HTTP call).
 *
 * Previously this ran a seeded pseudo-random generator that fabricated
 * PEP/Sanctions/Adverse Media hits against three hardcoded names. That mock
 * has been removed — every hit returned here now comes from Didit.
 */
import { base44 } from '@/api/base44Client';

/**
 * Run screening for a single entity.
 * @param {{ name: string, legalType?: 'NP'|'ORG', dateOfBirth?: string, nationality?: string, registrationNumber?: string, country?: string, tenantId: string }} entity
 * @returns {Promise<Array<{ hitName: string, source: string, confidenceScore: number, rawDetails: object }>>}
 * @throws if screening could not be performed (Didit not configured, API/network error) —
 *   callers must not treat a thrown error as "no hits found".
 */
export async function runScreening(entity) {
  const res = await base44.functions.invoke('screenEntityAml', {
    tenant_id:           entity.tenantId,
    full_name:           entity.name,
    legal_type:          entity.legalType || 'NP',
    date_of_birth:       entity.dateOfBirth || undefined,
    nationality:         entity.nationality || undefined,
    country:             entity.country || undefined,
    registration_number: entity.registrationNumber || undefined,
  });

  const data = res?.data || res;
  if (data?.error) {
    throw new Error(data.error);
  }
  return data?.hits || [];
}

/**
 * Triage: generate a recommendation + rationale for a hit based on Didit's
 * match confidence score. This is score-interpretation logic, independent
 * of where the hit came from.
 */
export function triageHit(hit, entity) {
  const score = hit.confidenceScore;
  if (score >= 80) {
    return {
      recommendation: 'Confirmed_Match',
      rationale: `HIGH confidence (${score}%) Didit AML match. Name match is strong with corroborating identity data. This hit warrants close review. Consider escalating to EDR.`,
    };
  }
  if (score >= 50) {
    return {
      recommendation: 'Possible_Match',
      rationale: `MEDIUM confidence (${score}%) Didit AML match. Some matching criteria found but not conclusive. Review the raw details carefully. Date of birth or registration number confirmation recommended before discounting.`,
    };
  }
  return {
    recommendation: 'Likely_False_Positive',
    rationale: `LOW confidence (${score}%) Didit AML match. Limited matching criteria. Name similarity may be coincidental. Consider discounting with written justification after reviewing details.`,
  };
}
