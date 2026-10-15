// Tipping-off lock helpers (shared by prepareFiuReport, unlockTippingOff and customer-communication paths).
// The TippingOffLock entity is the source of truth (backend-write only). Client.tipping_off_lock is a display mirror.
// Status semantics: only a NON-draft, non-rejected FIU report locks a client. A draft (missing mandatory data) never does.
import { asList, httpError } from './tmAuth.js';
import { writeAudit } from './tmAudit.js';

export const LOCK_MESSAGE = 'Customer communications locked — FIU report in progress (no tipping-off)';

/** True for report statuses that qualify for the lock (everything except draft and rejected). */
export const isLockingStatus = (status) => !!status && !['draft', 'rejected'].includes(status);

/** True when any TippingOffLock row for the client is active. Client.tipping_off_lock is ignored. */
export async function isClientLocked(base44, tenantId, clientId) {
  if (!tenantId || !clientId) throw httpError(400, 'tenant_id and client_id are required');
  const rows = asList(await base44.asServiceRole.entities.TippingOffLock.filter({ tenant_id: tenantId, client_id: clientId, locked: true }, undefined, 1));
  return rows.length > 0;
}

/** Rejects (423) when the client has an active lock row. */
export async function assertClientNotLocked(base44, tenantId, clientId) {
  if (await isClientLocked(base44, tenantId, clientId)) throw httpError(423, LOCK_MESSAGE);
}

/** Loads the client by tenant + id and rejects (423) when the lock is on. Call before sending any customer communication. */
export async function assertNotLocked(base44, clientId, tenantId) {
  if (!tenantId) throw httpError(400, 'tenant_id is required');
  if (!clientId) throw httpError(400, 'client_id is required');
  const client = asList(await base44.asServiceRole.entities.Client.filter({ tenant_id: tenantId, id: clientId }))[0];
  if (!client) throw httpError(404, 'Client not found');
  await assertClientNotLocked(base44, tenantId, clientId);
  return client;
}

/** Creates the lock row (idempotent per fiu_report_id), mirrors Client.tipping_off_lock for display and audits it. Returns true when newly applied. */
export async function lockClient(base44, { tenantId, clientId, reason, fiuReportId, actor }) {
  const E = base44.asServiceRole.entities;
  if (fiuReportId) {
    const dup = asList(await E.TippingOffLock.filter({ tenant_id: tenantId, client_id: clientId, fiu_report_id: fiuReportId, locked: true }, undefined, 1));
    if (dup.length) return false;
  }
  const lockedAt = new Date().toISOString();
  await E.TippingOffLock.create({
    tenant_id: tenantId, client_id: clientId, locked: true, reason, fiu_report_id: fiuReportId || undefined,
    locked_at: lockedAt, locked_by: actor?.actorName || actor?.actorUserId || 'system',
  });
  const client = asList(await E.Client.filter({ tenant_id: tenantId, id: clientId }))[0];
  if (client && !client.tipping_off_lock) {
    await E.Client.update(clientId, { tipping_off_lock: true, tipping_off_reason: reason, tipping_off_locked_at: lockedAt });
  }
  await writeAudit(base44, actor, {
    tenantId, clientId, eventType: 'tipping_off_locked',
    before: { tipping_off_lock: !!client?.tipping_off_lock },
    after: { tipping_off_lock: true, tipping_off_reason: reason, tipping_off_locked_at: lockedAt, fiu_report_id: fiuReportId || null },
    notes: `Customer communications locked: FIU report ${reason} is in progress.`,
  });
  return true;
}

/** Releases active lock rows (one report's, or all when fiuReportId is omitted) and clears the Client mirror only when no other lock stays active. */
export async function unlockClient(base44, { tenantId, clientId, fiuReportId, rationale, actor }) {
  const E = base44.asServiceRole.entities;
  const query = { tenant_id: tenantId, client_id: clientId, locked: true };
  if (fiuReportId) query.fiu_report_id = fiuReportId;
  const rows = asList(await E.TippingOffLock.filter(query, undefined, 100));
  const now = new Date().toISOString();
  for (const r of rows) {
    await E.TippingOffLock.update(r.id, { locked: false, unlocked_at: now, unlocked_by_user_id: actor?.actorUserId, unlock_rationale: rationale });
  }
  const stillActive = await isClientLocked(base44, tenantId, clientId);
  if (!stillActive) await E.Client.update(clientId, { tipping_off_lock: false, tipping_off_reason: '' });
  return { unlocked: rows.length, mirror_cleared: !stillActive };
}