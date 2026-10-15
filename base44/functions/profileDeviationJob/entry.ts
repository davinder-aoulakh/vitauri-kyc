// profileDeviationJob — nightly (03:00 UTC) comparison of rolling 30-day actuals with the approved ExpectedProfile.
// Scheduler calls it without a user and processes every tenant with tm_core enabled.
// A signed-in caller may only run it for their own tenant (Vitauri Ops: all tenants).
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.52';
import { isTmEnabled } from '../../shared/tmGuards.js';
import { asList, mapLimit, errorResponse, httpError } from '../../shared/tmAuth.js';
import { fetchAll } from '../../shared/tmCoverage.js';
import { summariseTxns, profileLimits, compareToProfile } from '../../shared/tmActuals.js';
import { upsertDeviationAlert } from '../../shared/tmDeviationAlert.js';
import { recomputeCustomerRisk } from '../../shared/tmRisk.js';

const CALLER_ROLES = ['Vitauri Ops', 'Tenant Admin', 'Compliance Admin', 'Compliance Officer'];
const SYSTEM_ACTOR = { actorType: 'System', actorName: 'Profile Deviation Job', actorUserId: undefined };
const DAY_MS = 86400000;

async function processTenant(base44, tenant, onlyClients) {
  const E = base44.asServiceRole.entities;
  const tid = tenant.id;
  const cur = tenant.tm_reporting_currency || 'USD';
  const since = new Date(Date.now() - 30 * DAY_MS).toISOString();
  const windowFrom = since.slice(0, 10);

  const txns = await fetchAll((cursor) => E.Transaction.filter({ tenant_id: tid, executed_at: { $gte: since } }, { limit: 1000, cursor }), 30);
  const byClient = new Map();
  for (const t of txns) {
    if (!t.client_id) continue;
    if (!byClient.has(t.client_id)) byClient.set(t.client_id, []);
    byClient.get(t.client_id).push(t);
  }
  const enabled = await fetchAll((cursor) => E.Client.filter({ tenant_id: tid, tm_enabled: true }, { limit: 1000, cursor }), 10);
  const ids = new Set([...byClient.keys(), ...enabled.map((c) => c.id)]);
  const clients = new Map(enabled.map((c) => [c.id, c]));
  for (const id of ids) {
    if (!clients.has(id)) {
      const c = asList(await E.Client.filter({ tenant_id: tid, id }))[0];
      if (c) clients.set(id, c);
    }
  }

  let alerts = 0;
  let recomputed = 0;
  const errors = [];
  const list = [...clients.values()].filter((c) => !c.is_deleted && (!onlyClients || onlyClients.has(c.id)));
  const results = await mapLimit(list, 3, async (client) => {
    const profile = asList(await E.ExpectedProfile.filter({ tenant_id: tid, client_id: client.id, status: 'approved' }, '-version', 1))[0];
    if (profile) {
      const actuals = summariseTxns(byClient.get(client.id) || [], { client, reportingCurrency: cur });
      const limits = await profileLimits(base44, tid, profile, cur);
      const cmp = compareToProfile(actuals, limits, profile.allowed_countries, cur);
      if (cmp.breaches.length || cmp.newCountries.length) {
        await upsertDeviationAlert(base44, { tenantId: tid, client, breaches: cmp.breaches, newCountries: cmp.newCountries, windowFrom });
        alerts++;
      }
    }
    await recomputeCustomerRisk(base44, { tenantId: tid, tenant, clientId: client.id, trigger: 'nightly_deviation', actor: SYSTEM_ACTOR });
    recomputed++;
  });
  results.forEach((r, i) => { if (!r.ok) errors.push(`${list[i].id}: ${String(r.error?.message || r.error).slice(0, 150)}`); });
  return { tenant_id: tid, clients: list.length, alerts, recomputed, errors: errors.slice(0, 10) };
}

export default async function (req) {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me().catch(() => null);
    let onlyTenant = null;
    // Optional client_ids (used by recomputeFx) limits the run to those clients of the caller's tenant.
    const body = await req.json().catch(() => ({}));
    const onlyClients = Array.isArray(body?.client_ids) && body.client_ids.length ? new Set(body.client_ids.map(String)) : null;
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
      try { results.push(await processTenant(base44, tenant, onlyClients)); } catch (e) {
        results.push({ tenant_id: tenant.id, error: String(e?.message || e).slice(0, 300) });
      }
    }
    return Response.json({ tenants: results.length, results });
  } catch (error) {
    return errorResponse(error);
  }
}