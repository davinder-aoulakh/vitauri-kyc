// replayDiditWebhook — Vitauri Ops only, Demo tenants only.
// Replays stored TmTestFixture payloads (signed with the Demo tenant's own webhook secret) through the real
// diditWebhook, in whatever tm_core state the tenant currently has, and returns the entity snapshots.
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.52';
import { asList, errorResponse, httpError } from '../../shared/tmAuth.js';
import { requireOpsDemo, replayFixtures, compare, parseFlags } from '../../shared/tmRegression.js';

export default async function (req) {
  try {
    const base44 = createClientFromRequest(req);
    const body = await req.json().catch(() => ({}));
    const { tenant, actorName } = await requireOpsDemo(base44, body.tenant_id);
    const E = base44.asServiceRole.entities;
    let fixtures = asList(await E.TmTestFixture.filter({ tenant_id: tenant.id, active: true }, { sort: 'order', limit: 100 }));
    if (Array.isArray(body.fixture_ids) && body.fixture_ids.length) fixtures = fixtures.filter((f) => body.fixture_ids.includes(f.id));
    if (!fixtures.length) throw httpError(404, 'No fixtures found for this tenant');
    const origin = req.headers.get('x-base44-app-url') || 'https://vitauri-kyc.base44.app';
    const tag = `replay${Date.now().toString(36)}`;
    const replay = await replayFixtures(base44, { tenant, fixtures, origin, actorName, tag });
    const mode = parseFlags(tenant).tm_core === true ? 'on' : 'off';
    const results = fixtures.map((f) => ({
      fixture_id: f.id, name: f.name, mode, ...replay[f.id],
      diffs: compare(f.expected?.[mode], replay[f.id]?.snapshot),
    }));
    return Response.json({ tenant_id: tenant.id, results });
  } catch (error) {
    return errorResponse(error);
  }
}