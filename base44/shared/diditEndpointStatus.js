// Reads the latest DiditEndpointCheck for a tenant (backend only; the entity is Ops-readable only).
import { asList } from './tmAuth.js';

export async function latestEndpointCheck(E, tenantId) {
  return asList(await E.DiditEndpointCheck.filter({ tenant_id: tenantId, kind: { $ne: 'credentials' } }, '-checked_at', 1))[0] || null;
}

/** True when the check classified the named endpoint as missing (404/405). */
export const isMissingInCheck = (check, name) => !!check?.results?.some((r) => r.name === name && r.classification === 'missing');