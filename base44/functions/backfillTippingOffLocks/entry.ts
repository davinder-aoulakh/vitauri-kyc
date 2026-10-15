// backfillTippingOffLocks — Vitauri Ops only. Creates a TippingOffLock for every Client with tipping_off_lock == true that has none.
// Optional body.tenant_id limits the run to one tenant; body.dry_run=true only counts. Idempotent.
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.52';
import { asList, errorResponse, httpError } from '../../shared/tmAuth.js';
import { writeAudit } from '../../shared/tmAudit.js';
import { fetchAll } from '../../shared/tmCoverage.js';

export default async function (req) {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me().catch(() => null);
    if (!user) throw httpError(401, 'Unauthorized');
    if ((user.app_role || user.data?.app_role) !== 'Vitauri Ops') throw httpError(403, 'Forbidden');
    const body = await req.json().catch(() => ({}));
    const auth = { actorType: 'User', actorName: user.full_name || user.email, actorUserId: user.id };
    const E = base44.asServiceRole.entities;

    const query = { tipping_off_lock: true };
    if (body.tenant_id) query.tenant_id = body.tenant_id;
    const clients = await fetchAll((cursor) => E.Client.filter(query, { limit: 500, cursor }), 20);

    let created = 0;
    let existing = 0;
    for (const c of clients) {
      if (!c.tenant_id) continue;
      const has = asList(await E.TippingOffLock.filter({ tenant_id: c.tenant_id, client_id: c.id }, undefined, 1));
      if (has.length) { existing++; continue; }
      if (body.dry_run) { created++; continue; }
      const report = c.tipping_off_reason
        ? asList(await E.FiuReport.filter({ tenant_id: c.tenant_id, client_id: c.id, report_ref: c.tipping_off_reason }, undefined, 1))[0]
        : null;
      const lockedAt = c.tipping_off_locked_at || new Date().toISOString();
      await E.TippingOffLock.create({
        tenant_id: c.tenant_id, client_id: c.id, locked: true, reason: c.tipping_off_reason || 'Backfilled from client flag',
        fiu_report_id: report?.id, locked_at: lockedAt, locked_by: `backfill (${auth.actorName})`,
      });
      await writeAudit(base44, auth, {
        tenantId: c.tenant_id, clientId: c.id, eventType: 'tipping_off_lock_backfilled',
        before: { lock_rows: 0 }, after: { tipping_off_lock: true, reason: c.tipping_off_reason || null, fiu_report_id: report?.id || null },
        notes: 'TippingOffLock row created from the existing client lock flag.',
      });
      created++;
    }
    return Response.json({ ok: true, dry_run: !!body.dry_run, flagged_clients: clients.length, created, already_had_lock: existing });
  } catch (error) {
    console.error('backfillTippingOffLocks error:', error?.message);
    return errorResponse(error);
  }
}