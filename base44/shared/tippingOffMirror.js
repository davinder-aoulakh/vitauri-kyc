// Daily check: restores Client.tipping_off_lock when it is false although an active TippingOffLock exists.
import { asList } from './tmAuth.js';
import { writeAudit } from './tmAudit.js';
import { fetchAll } from './tmCoverage.js';
import { tenantUsers, roleOf, CO_ROLES } from './tmCaseCommon.js';

const DAY = 24 * 3600000;
const SYSTEM = { actorType: 'System', actorName: 'System (deadlineSweep)', actorUserId: undefined };

/** Runs at most once per 24 h per tenant (gated by a 'tipping_off_mirror_checked' AuditEvent). */
export async function checkTippingOffMirror(base44, tenantId) {
  const E = base44.asServiceRole.entities;
  const since = new Date(Date.now() - DAY).toISOString();
  const done = asList(await E.AuditEvent.filter({ tenant_id: tenantId, event_type: 'tipping_off_mirror_checked', created_date: { $gte: since } }, undefined, 1));
  if (done.length) return { skipped: true, restored: 0 };

  const locks = await fetchAll((cursor) => E.TippingOffLock.filter({ tenant_id: tenantId, locked: true }, { limit: 500, cursor }), 10);
  const byClient = new Map();
  for (const l of locks) if (!byClient.has(l.client_id)) byClient.set(l.client_id, l);

  const restored = [];
  for (const [clientId, lock] of byClient) {
    const client = asList(await E.Client.filter({ tenant_id: tenantId, id: clientId }))[0];
    if (!client || client.tipping_off_lock) continue;
    await E.Client.update(clientId, { tipping_off_lock: true, tipping_off_reason: lock.reason, tipping_off_locked_at: lock.locked_at });
    await writeAudit(base44, SYSTEM, {
      tenantId, clientId, eventType: 'tipping_off_mirror_restored',
      before: { tipping_off_lock: false }, after: { tipping_off_lock: true, tipping_off_reason: lock.reason },
      notes: 'Client lock display flag was off while an active tipping-off lock exists; flag restored.',
    });
    restored.push({ clientId, name: client.full_name });
  }

  if (restored.length) {
    const cos = (await tenantUsers(E, tenantId)).filter((u) => CO_ROLES.includes(roleOf(u)));
    const day = new Date().toISOString().slice(0, 10);
    const rows = [];
    for (const r of restored) {
      for (const u of cos) {
        rows.push({
          tenant_id: tenantId, user_id: u.id, type: 'tm_escalation', is_read: false, link_client_id: r.clientId,
          dedupe_key: `tipping_off_mirror:${u.id}:${r.clientId}:${day}`,
          title: `Tipping-off lock flag restored: ${r.name || r.clientId}`,
          body: 'The client lock flag had been cleared while an active tipping-off lock exists. It was restored automatically.',
        });
      }
    }
    if (rows.length) await E.Notification.bulkCreate(rows);
  }

  await writeAudit(base44, SYSTEM, {
    tenantId, eventType: 'tipping_off_mirror_checked', before: {}, after: { active_locks: locks.length, restored: restored.length },
    notes: `Daily tipping-off mirror check: ${restored.length} restored.`,
  });
  return { skipped: false, restored: restored.length };
}