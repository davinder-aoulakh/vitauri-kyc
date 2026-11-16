// Tipping-off lock helpers (shared by prepareFiuReport, unlockTippingOff and customer-communication paths).
// The TippingOffLock entity is the source of truth (backend-write only). Client.tipping_off_lock is a display mirror.
// Status semantics: only a NON-draft, non-rejected FIU report locks a client. A draft (missing mandatory data) never does.
import { asList, httpError } from './tmAuth.js';
import { writeAudit } from './tmAudit.js';

export const LOCK_MESSAGE = 'Customer communications locked — FIU report in progress (no tipping-off)';
// AML hold (phase 6, gap G22): the same block applies while an investigation is open or decided for reporting.
export const HOLD_MESSAGE = 'Customer communications blocked — AML hold (no tipping-off)';
export const HOLD_REASON = 'AML hold: investigation open';
export const HOLD_CASE_STATUSES = ['open', 'investigating', 'pending_co', 'decided_report'];

/** Pure: does this investigation put its customers on hold? */
export const caseHolds = (tmCase) => HOLD_CASE_STATUSES.includes(tmCase?.status);
/** Pure: why a client is locked, from its lock rows and investigations. 'fiu' | 'investigation' | null. */
export function holdReason(lockRows, cases, clientId) {
  if ((lockRows || []).some((l) => l.locked && !l.unlocked_at)) return 'fiu';
  const mine = (c) => c.primary_client_id === clientId || (c.client_ids || []).includes(clientId);
  return (cases || []).some((c) => caseHolds(c) && mine(c)) ? 'investigation' : null;
}

/** True when the client is the primary or a listed customer of an investigation that holds. Never throws. */
export async function hasOpenInvestigation(base44, tenantId, clientId) {
  const E = base44.asServiceRole.entities;
  try {
    const a = asList(await E.TmCase.filter({ tenant_id: tenantId, primary_client_id: clientId, status: { $in: HOLD_CASE_STATUSES } }, undefined, 1));
    if (a.length) return true;
    const b = asList(await E.TmCase.filter({ tenant_id: tenantId, client_ids: clientId, status: { $in: HOLD_CASE_STATUSES } }, undefined, 5));
    return b.some((c) => (c.client_ids || []).includes(clientId));
  } catch (e) {
    console.warn('hasOpenInvestigation failed', e?.message || e);
    return false;
  }
}

/** True for report statuses that qualify for the lock (everything except draft and rejected). */
export const isLockingStatus = (status) => !!status && !['draft', 'rejected'].includes(status);

/**
 * True when a TippingOffLock row for the client is active, or (unless opts.fiuOnly) the client is on AML hold
 * because of an investigation. Client.tipping_off_lock is ignored (display mirror only).
 */
export async function isClientLocked(base44, tenantId, clientId, opts = {}) {
  if (!tenantId || !clientId) throw httpError(400, 'tenant_id and client_id are required');
  const rows = asList(await base44.asServiceRole.entities.TippingOffLock.filter({ tenant_id: tenantId, client_id: clientId, locked: true }, undefined, 1));
  if (rows.length > 0) return true;
  if (opts.fiuOnly) return false;
  return hasOpenInvestigation(base44, tenantId, clientId);
}

/** Rejects (423) when the client has an active lock row or is on AML hold. */
export async function assertClientNotLocked(base44, tenantId, clientId) {
  if (await isClientLocked(base44, tenantId, clientId, { fiuOnly: true })) throw httpError(423, LOCK_MESSAGE);
  if (await hasOpenInvestigation(base44, tenantId, clientId)) throw httpError(423, HOLD_MESSAGE);
}

/** The check as it was before the AML hold: only an FIU report in progress blocks. For the investigation's own customer request. */
export async function assertNoFiuLock(base44, tenantId, clientId) {
  if (await isClientLocked(base44, tenantId, clientId, { fiuOnly: true })) throw httpError(423, LOCK_MESSAGE);
}

/**
 * Keeps the display mirror (Client.tipping_off_lock) in step with investigations. Sets it when the client is on
 * hold; clears it only when the mirror was set by an investigation and nothing holds any more. Never throws.
 */
export async function refreshAmlHold(base44, tenantId, clientId, actor) {
  try {
    if (!tenantId || !clientId) return null;
    const E = base44.asServiceRole.entities;
    const client = asList(await E.Client.filter({ tenant_id: tenantId, id: clientId }))[0];
    if (!client) return null;
    const fiu = await isClientLocked(base44, tenantId, clientId, { fiuOnly: true });
    const inv = fiu ? false : await hasOpenInvestigation(base44, tenantId, clientId);
    if (inv && !client.tipping_off_lock) {
      const at = new Date().toISOString();
      await E.Client.update(clientId, { tipping_off_lock: true, tipping_off_reason: HOLD_REASON, tipping_off_locked_at: at });
      await writeAudit(base44, actor || { actorType: 'System', actorName: 'System (AML hold)' }, {
        tenantId, clientId, eventType: 'aml_hold_set', before: { tipping_off_lock: false }, after: { tipping_off_lock: true, tipping_off_reason: HOLD_REASON },
        notes: 'AML hold set: an investigation is open for this customer. Customer communications are blocked.',
      });
      return 'set';
    }
    if (!fiu && !inv && client.tipping_off_lock && client.tipping_off_reason === HOLD_REASON) {
      await E.Client.update(clientId, { tipping_off_lock: false, tipping_off_reason: '' });
      await writeAudit(base44, actor || { actorType: 'System', actorName: 'System (AML hold)' }, {
        tenantId, clientId, eventType: 'aml_hold_cleared', before: { tipping_off_lock: true, tipping_off_reason: HOLD_REASON }, after: { tipping_off_lock: false },
        notes: 'AML hold cleared: no open investigation and no FIU report in progress.',
      });
      return 'cleared';
    }
    return null;
  } catch (e) {
    console.warn('refreshAmlHold failed', e?.message || e);
    return null;
  }
}

/** refreshAmlHold for every customer of an investigation (primary and listed). */
export async function refreshAmlHoldForCase(base44, tenantId, tmCase, actor) {
  const ids = [...new Set([tmCase?.primary_client_id, ...(tmCase?.client_ids || [])].filter(Boolean))];
  for (const id of ids) await refreshAmlHold(base44, tenantId, id, actor);
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
  else if (!(await isClientLocked(base44, tenantId, clientId, { fiuOnly: true }))) await E.Client.update(clientId, { tipping_off_lock: true, tipping_off_reason: HOLD_REASON });
  return { unlocked: rows.length, mirror_cleared: !stillActive };
}