// Shared glue: resolve counterparties for transactions and persist the links (tenant-scoped).
import { resolveTransactions } from './tmCounterparty.js';
import { invokeNext } from './tmAuth.js';

/** Builds the screening callback. Calls the existing screenEntityAml function (unchanged) for NP/ORG only. */
export function makeScreenFn(base44, auth, tenantId) {
  return async (cp) => {
    const legalType = cp.entity_kind === 'company' ? 'ORG' : cp.entity_kind === 'person' ? 'NP' : null;
    if (!legalType) return null;
    const res = await invokeNext(base44, auth, 'screenEntityAml', {
      tenant_id: tenantId,
      full_name: cp.display_name,
      legal_type: legalType,
      country: cp.country,
    });
    if (!res || res.error || !Array.isArray(res.hits)) throw new Error(res?.error || 'screening failed');
    const hit_refs = res.hits.map((h) => `${h.source}:${h.hitName}:${h.confidenceScore}`).slice(0, 50);
    return { status: res.hits.length ? 'potential_match' : 'clear', hit_refs };
  };
}

/** Resolves counterparties for the given (already tenant-verified) transactions and writes the links. */
export async function resolveAndStore(base44, auth, tenantId, txns, sourceRef) {
  const { updates, stats } = await resolveTransactions(base44, {
    tenantId, txns, sourceRef, screenFn: makeScreenFn(base44, auth, tenantId),
  });
  return { updates, stats };
}