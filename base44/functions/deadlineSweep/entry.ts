// deadlineSweep — hourly (minute 5). Recomputes due_at/phase for open TmAlerts and TmCases via tmClock and
// notifies assignees of items due within 24 h or expired (no duplicate within 12 h). Processes tenants with tm_core.
// A signed-in caller may only run it for their own tenant (Vitauri Ops: all tenants).
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.52';
import { isTmEnabled } from '../../shared/tmGuards.js';
import { asList, errorResponse, httpError } from '../../shared/tmAuth.js';
import { fetchAll } from '../../shared/tmCoverage.js';
import { OPEN_ALERT, OPEN_CASE, loadFiuProfile, alertClock, caseClock } from '../../shared/tmDeadline.js';

const CALLER_ROLES = ['Vitauri Ops', 'Tenant Admin', 'Compliance Admin', 'Compliance Officer'];
const HOUR = 3600000;

function kindOf(dueAt, now) {
  if (!dueAt) return null;
  const t = new Date(dueAt).getTime();
  if (t < now) return 'expired';
  return t - now <= 24 * HOUR ? 'due_soon' : null;
}

async function processTenant(base44, tenant) {
  const E = base44.asServiceRole.entities;
  const tid = tenant.id;
  const now = Date.now();
  const fiu = await loadFiuProfile(E, tenant);

  const alerts = await fetchAll((cursor) => E.TmAlert.filter({ tenant_id: tid, status: { $in: OPEN_ALERT } }, { limit: 500, cursor }), 20);
  const cases = await fetchAll((cursor) => E.TmCase.filter({ tenant_id: tid, status: { $in: OPEN_CASE } }, { limit: 500, cursor }), 20);

  let updated = 0;
  const items = []; // { id, type: 'alert'|'case', assignee, due_at, label, clientId }
  for (const a of alerts) {
    let due = a.due_at;
    if (fiu) {
      const c = alertClock(fiu, a);
      if (c.due_at && (c.due_at !== a.due_at || c.phase !== a.phase || c.expired_on_arrival !== !!a.expired_on_arrival)) {
        await E.TmAlert.update(a.id, { due_at: c.due_at, phase: c.phase, expired_on_arrival: c.expired_on_arrival });
        updated++;
      }
      due = c.due_at || due;
    }
    items.push({ id: a.id, type: 'alert', assignee: a.assigned_to_user_id, due_at: due, label: a.title || `Alert ${a.id.slice(-6)}`, clientId: a.client_id });
  }
  for (const c of cases) {
    let due = c.due_at;
    if (fiu) {
      const first = c.alert_ids?.[0] ? asList(await E.TmAlert.filter({ tenant_id: tid, id: c.alert_ids[0] }))[0] : null;
      const clock = caseClock(fiu, c, first?.indicator_type || 'subjective');
      if (clock.due_at && clock.due_at !== c.due_at) {
        await E.TmCase.update(c.id, { due_at: clock.due_at });
        updated++;
      }
      due = clock.due_at || due;
    }
    items.push({ id: c.id, type: 'case', assignee: c.assigned_to_user_id, due_at: due, label: c.title || c.case_ref || `Case ${c.id.slice(-6)}`, clientId: c.primary_client_id });
  }

  const recent = await fetchAll((cursor) => E.Notification.filter({
    tenant_id: tid, type: 'tm_deadline', created_date: { $gte: new Date(now - 12 * HOUR).toISOString() },
  }, { limit: 500, cursor }), 10);
  const seen = new Set(recent.map((n) => n.dedupe_key).filter(Boolean));

  const toCreate = [];
  for (const it of items) {
    const kind = kindOf(it.due_at, now);
    if (!kind || !it.assignee) continue;
    const key = `${it.assignee}:${it.type}:${it.id}:${kind}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const what = it.type === 'case' ? 'Case' : 'Alert';
    toCreate.push({
      tenant_id: tid, user_id: it.assignee, type: 'tm_deadline', is_read: false, dedupe_key: key, link_client_id: it.clientId || undefined,
      ...(it.type === 'case' ? { link_tm_case_id: it.id } : { link_alert_id: it.id }),
      title: kind === 'expired' ? `${what} deadline expired: ${it.label}` : `${what} due within 24 h: ${it.label}`,
      body: `Deadline ${new Date(it.due_at).toISOString().replace('T', ' ').slice(0, 16)} UTC.`,
    });
  }
  if (toCreate.length) await E.Notification.bulkCreate(toCreate);
  return { tenant_id: tid, fiu_profile: !!fiu, alerts: alerts.length, cases: cases.length, clocks_updated: updated, notifications: toCreate.length };
}

export default async function (req) {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me().catch(() => null);
    let onlyTenant = null;
    if (user) {
      const role = user.app_role || user.data?.app_role;
      if (!CALLER_ROLES.includes(role)) throw httpError(403, 'Forbidden');
      if (role !== 'Vitauri Ops') {
        onlyTenant = user.tenant_id || user.data?.tenant_id;
        if (!onlyTenant) throw httpError(403, 'No tenant associated with this user');
      }
    }
    const tenants = asList(await base44.asServiceRole.entities.Tenant.list('-created_date', 1000))
      .filter((t) => t.status !== 'Suspended' && isTmEnabled(t, 'tm_core') && (!onlyTenant || t.id === onlyTenant));
    const results = [];
    for (const tenant of tenants) {
      try { results.push(await processTenant(base44, tenant)); } catch (e) {
        results.push({ tenant_id: tenant.id, error: String(e?.message || e).slice(0, 300) });
      }
    }
    return Response.json({ tenants: results.length, results });
  } catch (error) {
    return errorResponse(error);
  }
}