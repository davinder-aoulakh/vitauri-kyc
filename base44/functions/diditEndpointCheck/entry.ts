// diditEndpointCheck — Vitauri Ops only. Probes the Didit TM endpoints with the safest possible calls on a DEMO tenant
// and stores the HTTP outcome. Never creates FIU reports, cases, rules or transactions. Never logs or returns credentials.
// Input: { tenant_id } (must have status 'Demo').
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.52';
import { asList, errorResponse, httpError, loadTenant } from '../../shared/tmAuth.js';
import { withDiditCredentials } from '../../shared/diditCredentials.js';
import { writeAudit } from '../../shared/tmAudit.js';
import { tmPath, probe } from '../../shared/diditTm.js';

const classify = (s) => {
  if (s >= 200 && s < 300) return 'ok';
  if (s === 400 || s === 422) return 'reachable';
  if (s === 404 || s === 405) return 'missing';
  if (s === 401 || s === 403) return 'auth';
  if (s === 0 || s === 429 || s >= 500) return 'error';
  return 'reachable';
};

const AMBIGUOUS = 'A 404 can also mean this id does not exist in Didit.';

export default async function (req) {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me().catch(() => null);
    if (!user) throw httpError(401, 'Unauthorized');
    if ((user.app_role || user.data?.app_role) !== 'Vitauri Ops') throw httpError(403, 'Forbidden');
    const body = await req.json().catch(() => ({}));
    if (!body.tenant_id) throw httpError(400, 'tenant_id is required');
    const E = base44.asServiceRole.entities;
    const tenantRow = await loadTenant(base44, body.tenant_id);
    if (tenantRow.status !== 'Demo') throw httpError(400, 'Endpoint checks can only run on a Demo tenant');
    const tenant = await withDiditCredentials(base44, tenantRow);
    if (!tenant.didit_api_key) throw httpError(400, 'Didit is not configured for this tenant');
    const tid = tenant.id;

    const rule = asList(await E.TmRule.filter({ tenant_id: tid, didit_rule_id: { $exists: true } }, '-created_date', 20)).find((r) => r.didit_rule_id);
    const txn = asList(await E.Transaction.filter({ tenant_id: tid, didit_transaction_id: { $exists: true } }, '-created_date', 20)).find((t) => t.didit_transaction_id);
    const client = asList(await E.Client.filter({ tenant_id: tid }, '-created_date', 1))[0];

    const plan = [
      { name: 'rules', method: 'GET', path: tmPath(tenant, 'rules') },
      rule
        ? { name: 'rule', method: 'GET', path: tmPath(tenant, 'rule', rule.didit_rule_id), note: AMBIGUOUS }
        : { name: 'rule', method: 'GET', path: tmPath(tenant, 'rule', '{id}'), skip: 'No synced rule in this tenant to probe' },
      { name: 'ruleBacktest', method: 'POST', path: tmPath(tenant, 'ruleBacktest'), body: { conditions: [], aggregation: [], evaluation_mode: 'ALL', scope: {}, period_days: 1 }, note: 'Empty one-day window. 200 or 400 means the path exists.' },
      txn
        ? { name: 'transaction', method: 'GET', path: tmPath(tenant, 'transaction', txn.didit_transaction_id), note: AMBIGUOUS }
        : { name: 'transaction', method: 'GET', path: tmPath(tenant, 'transaction', '{id}'), skip: 'No transaction with a Didit id in this tenant to probe' },
      client
        ? { name: 'userCustomProperties', method: 'PATCH', path: tmPath(tenant, 'userCustomProperties', client.id), body: { custom_properties: {} }, note: 'Empty custom_properties. A 404 can also mean this client has no Didit user yet.' }
        : { name: 'userCustomProperties', method: 'PATCH', path: tmPath(tenant, 'userCustomProperties', '{vendorData}'), skip: 'No client in this tenant to probe' },
      { name: 'fiuReports', method: 'GET', path: tmPath(tenant, 'fiuReports'), note: 'List only. No report is created.' },
      { name: 'cases', method: 'GET', path: tmPath(tenant, 'cases'), note: 'List only. No case is created.' },
    ];

    const results = await Promise.all(plan.map(async (p) => {
      const base = { name: p.name, method: p.method, path: p.path };
      if (p.skip) return { ...base, status: 0, classification: 'skipped', note: p.skip };
      const r = await probe(tenant, p.method, p.path, p.body);
      const cls = classify(r.status);
      return { ...base, status: r.status, classification: cls, note: r.error || (cls === 'missing' || cls === 'reachable' ? p.note || '' : '') };
    }));

    const checkedAt = new Date().toISOString();
    const record = await E.DiditEndpointCheck.create({ tenant_id: tid, checked_at: checkedAt, results });
    const summary = results.reduce((acc, r) => ({ ...acc, [r.classification]: (acc[r.classification] || 0) + 1 }), {});
    await writeAudit(base44, { actorType: 'User', actorName: user.full_name || user.email, actorUserId: user.id }, {
      tenantId: tid, eventType: 'didit_endpoint_check_run', before: {}, after: { check_id: record.id, summary },
      notes: `Didit TM endpoint check run on Demo tenant ${tenant.name}.`,
    });
    return Response.json({ ok: true, check: record });
  } catch (error) {
    console.error('diditEndpointCheck error:', error?.message);
    return errorResponse(error);
  }
}