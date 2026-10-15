// scenarioRelease — switch a scenario's bulk-close or AI sample-review release on or off.
// Auth: signed-in Director or Compliance Officer (tmQuality + release role); tenant from the user. Requires tm_quality.
// Switching ON needs a completed ai_shadow sample for the scenario from the last 90 days with missed = 0 and
// wrongly_closed <= tenant.tm_settings.max_wrongly_closed_pct (default 2%) of the AI close proposals. Switching OFF is always allowed.
// The qualifying sample id is stored on the scenario and in the AuditEvent.
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.52';
import { isTmEnabled } from '../../shared/tmGuards.js';
import { authenticate, errorResponse, httpError, loadTenant, asList } from '../../shared/tmAuth.js';
import { writeAudit } from '../../shared/tmAudit.js';
import { RELEASE_ROLES, qualifies, maxWronglyClosedPct } from '../../shared/tmQuality.js';

const FLAGS = {
  bulk_close_released: 'bulk_close_release_sample_id',
  ai_sample_review_released: 'ai_sample_review_release_sample_id',
};

export default async function (req) {
  try {
    const base44 = createClientFromRequest(req);
    const body = await req.json();
    const auth = await authenticate(base44, req, body, { roles: RELEASE_ROLES, allowApiKey: false });
    const tenantId = auth.tenantId;
    const tenant = await loadTenant(base44, tenantId);
    if (!isTmEnabled(tenant, 'tm_quality')) throw httpError(403, 'Feature tm_quality is not enabled');
    const E = base44.asServiceRole.entities;

    const flag = body.flag;
    if (!FLAGS[flag]) throw httpError(400, 'flag must be bulk_close_released or ai_sample_review_released');
    if (typeof body.value !== 'boolean') throw httpError(400, 'value must be true or false');
    const scenario = asList(await E.TmScenario.filter({ tenant_id: tenantId, id: body.scenario_id }))[0];
    if (!scenario || scenario.tenant_id !== tenantId) throw httpError(404, 'Scenario not found');
    const before = { [flag]: scenario[flag] === true, sample_id: scenario[FLAGS[flag]] || null };

    let sampleId: string | null = null;
    let pct: number | undefined;
    if (body.value) {
      const since = new Date(Date.now() - 90 * 86400000).toISOString();
      const samples = asList(await E.QualitySample.filter(
        { tenant_id: tenantId, sample_type: 'ai_shadow', status: 'completed', scenario_id: scenario.id, completed_at: { $gte: since } }, '-completed_at', 20,
      )).filter((s) => s.tenant_id === tenantId);
      if (!samples.length) throw httpError(422, 'A completed AI shadow sample for this scenario from the last 90 days is required.');
      const limit = maxWronglyClosedPct(tenant);
      const latest = samples[0]; // the most recent sample decides; an older good one cannot hide a newer failure
      const q = qualifies(latest.metrics, limit);
      if (!q.ok) throw httpError(422, `The latest AI shadow sample does not qualify: ${q.reason}`);
      sampleId = latest.id; pct = q.pct;
    }
    const patch = { [flag]: body.value, [FLAGS[flag]]: sampleId || undefined };
    await E.TmScenario.update(scenario.id, patch);
    await writeAudit(base44, auth, {
      tenantId, eventType: body.value ? 'tm_scenario_released' : 'tm_scenario_release_revoked', before,
      after: { [flag]: body.value, sample_id: sampleId, wrongly_closed_pct: pct ?? null, max_wrongly_closed_pct: maxWronglyClosedPct(tenant) },
      notes: body.value
        ? `${flag === 'bulk_close_released' ? 'Bulk close' : 'AI sample review'} released for ${scenario.code} by ${auth.actorName}, qualified by quality sample ${sampleId}.`
        : `${flag === 'bulk_close_released' ? 'Bulk close' : 'AI sample review'} release revoked for ${scenario.code} by ${auth.actorName}.`,
    });
    return Response.json({ ok: true, scenario_id: scenario.id, flag, value: body.value, sample_id: sampleId });
  } catch (error) {
    console.error('scenarioRelease error:', error?.message);
    return errorResponse(error);
  }
}