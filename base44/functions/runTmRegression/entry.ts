// runTmRegression — Vitauri Ops only, Demo tenants only.
// action 'seed': create the 12 starter fixtures for the tenant when it has none.
// action 'run' : replay every fixture with tm_core OFF, then ON, compare to expected, restore the original flag (always).
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.52';
import { asList, errorResponse, httpError } from '../../shared/tmAuth.js';
import { requireOpsDemo, replayFixtures, compare, setTmCore, audit, parseFlags } from '../../shared/tmRegression.js';
import { SEED_FIXTURES } from '../../shared/tmRegressionFixtures.js';

export default async function (req) {
  try {
    const base44 = createClientFromRequest(req);
    const body = await req.json().catch(() => ({}));
    const { user, tenant, actorName } = await requireOpsDemo(base44, body.tenant_id);
    const E = base44.asServiceRole.entities;
    const tenantId = tenant.id;

    if (body.action === 'seed') {
      const existing = await E.TmTestFixture.count({ tenant_id: tenantId });
      const have = new Set(asList(await E.TmTestFixture.filter({ tenant_id: tenantId }, { limit: 200 })).map((f) => f.name));
      const missing = SEED_FIXTURES.filter((f) => !have.has(f.name));
      if (missing.length === 0) return Response.json({ seeded: 0, existing });
      await E.TmTestFixture.bulkCreate(missing.map((f) => ({ ...f, tenant_id: tenantId, active: true })));
      await audit(E, tenantId, actorName, 'tm_regression_fixtures_seeded', {}, { count: missing.length }, `${missing.length} regression fixtures seeded for ${tenant.name}.`);
      return Response.json({ seeded: missing.length });
    }

    if (body.action !== 'run') throw httpError(400, "action must be 'seed' or 'run'");

    const fixtures = asList(await E.TmTestFixture.filter({ tenant_id: tenantId, active: true }, { sort: 'order', limit: 100 }));
    if (!fixtures.length) throw httpError(404, 'No fixtures found. Open the page again to seed them.');
    if (!tenant.didit_webhook_secret) throw httpError(409, 'This Demo tenant has no Didit webhook secret, so signed replays cannot be accepted.');

    const recent = asList(await E.TmRegressionRun.filter({ tenant_id: tenantId, status: 'running' }, { sort: '-created_date', limit: 1 }))[0];
    if (recent && Date.now() - new Date(recent.started_at).getTime() < 10 * 60 * 1000) throw httpError(409, 'A regression run is already in progress for this tenant.');

    const originalRaw = tenant.features_enabled ?? null;
    const originalOn = parseFlags(tenant).tm_core === true;
    const run = await E.TmRegressionRun.create({
      tenant_id: tenantId, status: 'running', run_by_user_id: user.id, run_by_name: actorName,
      original_tm_core: originalOn, original_features_enabled: originalRaw ?? '', flag_restored: false, started_at: new Date().toISOString(),
    });
    await audit(E, tenantId, actorName, 'tm_regression_started', { tm_core: originalOn }, { run_id: run.id }, `Regression run ${run.id} started on ${tenant.name}.`);

    const origin = req.headers.get('x-base44-app-url') || 'https://vitauri-kyc.base44.app';
    let off = null;
    let on = null;
    let failure = null;
    try {
      const offTenant = await setTmCore(E, tenant, false, actorName, run.id);
      off = await replayFixtures(base44, { tenant: offTenant, fixtures, origin, actorName, tag: `${run.id.slice(-5)}off` });
      const onTenant = await setTmCore(E, offTenant, true, actorName, run.id);
      on = await replayFixtures(base44, { tenant: onTenant, fixtures, origin, actorName, tag: `${run.id.slice(-5)}on` });
    } catch (e) {
      failure = String(e?.message || e).slice(0, 500);
    } finally {
      // Always restore the original flag state, even when a replay failed.
      await E.Tenant.update(tenantId, { features_enabled: originalRaw ?? '' }).catch((e) => { failure = `${failure || ''} RESTORE FAILED: ${e?.message}`; });
      await audit(E, tenantId, actorName, 'feature_flag_changed', { feature: 'tm_core', enabled: 'test value' }, { feature: 'tm_core', enabled: originalOn },
        `Regression run ${run.id}: tm_core restored to ${originalOn ? 'ON' : 'OFF'} for ${tenant.name}.`);
    }
    const afterTenant = asList(await E.Tenant.filter({ id: tenantId }))[0];
    const restored = (parseFlags(afterTenant).tm_core === true) === originalOn && (afterTenant?.features_enabled ?? '') === (originalRaw ?? '');

    const results = fixtures.map((f) => {
      const o = off?.[f.id];
      const n = on?.[f.id];
      const skipped = f.kind === 'real_session' && !!o?.skipped && !!n?.skipped;
      const offDiffs = skipped ? [] : o ? compare(f.expected?.off, o.snapshot) : [{ field: 'run', expected: 'completed', actual: failure || 'not run' }];
      const onDiffs = skipped ? [] : n ? compare(f.expected?.on, n.snapshot) : [{ field: 'run', expected: 'completed', actual: failure || 'not run' }];
      const identicalRequired = f.kind === 'session';
      const identicalOk = identicalRequired && o && n ? JSON.stringify(o.snapshot) === JSON.stringify(n.snapshot) : null;
      return {
        fixture_id: f.id, name: f.name, kind: f.kind, webhook_type: f.webhook_type,
        off: { ...(o || {}), diffs: offDiffs, expected: f.expected?.off },
        on: { ...(n || {}), diffs: onDiffs, expected: f.expected?.on },
        identical_required: identicalRequired, identical_ok: identicalOk, skipped,
        pass: offDiffs.length === 0 && onDiffs.length === 0 && identicalOk !== false && !o?.error && !n?.error,
      };
    });
    const passed = results.filter((r) => r.pass && !r.skipped).length;
    const skippedCount = results.filter((r) => r.skipped).length;
    const finished = await E.TmRegressionRun.update(run.id, {
      status: failure ? 'failed' : 'completed', finished_at: new Date().toISOString(), flag_restored: restored,
      results, passed, failed: results.length - passed - skippedCount, error: failure || undefined,
    });
    await audit(E, tenantId, actorName, 'tm_regression_finished', { run_id: run.id }, { passed, failed: results.length - passed, flag_restored: restored }, `Regression run ${run.id} finished: ${passed}/${results.length} passed.`);
    return Response.json({ run: finished });
  } catch (error) {
    return errorResponse(error);
  }
}