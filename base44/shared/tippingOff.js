// Tipping-off lock helpers (shared by prepareFiuReport, unlockTippingOff and customer-communication paths).
// Status semantics: only a NON-draft, non-rejected FIU report locks a client. A draft (missing mandatory data) never does.
import { asList, httpError } from './tmAuth.js';
import { writeAudit } from './tmAudit.js';

export const LOCK_MESSAGE = 'Customer communications locked — FIU report in progress (no tipping-off)';

/** True for report statuses that qualify for the lock (everything except draft and rejected). */
export const isLockingStatus = (status) => !!status && !['draft', 'rejected'].includes(status);

/** Pure check on an already-loaded (tenant-verified) client record. */
export function assertClientNotLocked(client) {
  if (client?.tipping_off_lock) throw httpError(423, LOCK_MESSAGE);
}

/** Loads the client by tenant + id and rejects (423) when the lock is on. Call before sending any customer communication. */
export async function assertNotLocked(base44, clientId, tenantId) {
  if (!tenantId) throw httpError(400, 'tenant_id is required');
  if (!clientId) throw httpError(400, 'client_id is required');
  const client = asList(await base44.asServiceRole.entities.Client.filter({ tenant_id: tenantId, id: clientId }))[0];
  if (!client) throw httpError(404, 'Client not found');
  assertClientNotLocked(client);
  return client;
}

/** Turns the lock on (idempotent) and audits it. Returns true when the lock was newly applied. */
export async function lockClient(base44, auth, { tenantId, client, reportRef }) {
  if (client.tipping_off_lock) return false;
  const lockedAt = new Date().toISOString();
  await base44.asServiceRole.entities.Client.update(client.id, { tipping_off_lock: true, tipping_off_reason: reportRef, tipping_off_locked_at: lockedAt });
  await writeAudit(base44, auth, {
    tenantId, clientId: client.id, eventType: 'tipping_off_locked',
    before: { tipping_off_lock: false },
    after: { tipping_off_lock: true, tipping_off_reason: reportRef, tipping_off_locked_at: lockedAt },
    notes: `Customer communications locked: FIU report ${reportRef} is in progress.`,
  });
  return true;
}