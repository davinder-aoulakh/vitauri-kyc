// runQualitySample — starts an independent TM quality sample.
//  below_the_line: random N transactions in the period that produced no TmAlert (reviewers mark ok / missed_signal).
//  file_review:    random N closed TmAlerts in the period (reviewers mark ok / wrongly_closed; never the person who closed it).
//  ai_shadow:      compares AI triage proposals with the final human outcome for one scenario; completes immediately.
// Auth: signed-in user with tmQuality (QC Reviewer, Compliance Officer, Director); tenant from the user. Requires tm_quality.
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.52';
import { isTmEnabled } from '../../shared/tmGuards.js';
import { authenticate, errorResponse, httpError, loadTenant, asList } from '../../shared/tmAuth.js';
import { writeAudit } from '../../shared/tmAudit.js';
import { QUALITY_ROLES, CLOSED, MAX_POPULATION, checkPeriod, dayStart, dayEnd, pickRandom, fetchAll, shadowCompare, scenarioOwner } from '../../shared/tmQuality.js';

const DEFAULT_SIZE = { below_the_line: 400, file_review: 30 };
const MAX_SIZE = 1000;
const money = (t) => `${(t.direction || '').toUpperCase()} ${t.amount ?? ''} ${t.currency || ''} · ${t.counterparty_name || 'unknown counterparty'} · ${String(t.executed_at || '').slice(0, 10)}`;

export default async function (req) {
  try {
    const base44 = createClientFromRequest(req);
    const body = await req.json();
    const auth = await authenticate(base44, req, body, { roles: QUALITY_ROLES, allowApiKey: false });
    const tenantId = auth.tenantId;
    const tenant = await loadTenant(base44, tenantId);
    if (!isTmEnabled(tenant, 'tm_quality')) throw httpError(403, 'Feature tm_quality is not enabled');
    const E = base44.asServiceRole.entities;

    const type = body.sample_type;
    if (!['below_the_line', 'file_review', 'ai_shadow'].includes(type)) throw httpError(400, 'sample_type must be below_the_line, file_review or ai_shadow');
    checkPeriod(body.period_from, body.period_to);
    const from = body.period_from, to = body.period_to;
    const requested = Number(body.sample_size);
    const size = Math.min(MAX_SIZE, Number.isFinite(requested) && requested >= 1 ? Math.floor(requested) : DEFAULT_SIZE[type] || 0);

    let scenario = null;
    if (body.scenario_id) {
      scenario = asList(await E.TmScenario.filter({ tenant_id: tenantId, id: body.scenario_id }))[0];
      if (!scenario) throw httpError(404, 'Scenario not found');
    }

    const base = {
      tenant_id: tenantId, sample_type: type, period_from: from, period_to: to, scenario_id: scenario?.id,
      created_by_user_id: auth.actorUserId, created_by_name: auth.actorName,
    };
    let record;

    if (type === 'below_the_line') {
      const alerts = await fetchAll(E.TmAlert, { tenant_id: tenantId, created_date: { $gte: dayStart(from), $lte: new Date(Date.parse(dayEnd(to)) + 30 * 86400000).toISOString() } }, '-created_date');
      const alerted = new Set(alerts.rows.flatMap((a) => a.transaction_ids || []));
      const txns = await fetchAll(E.Transaction, { tenant_id: tenantId, executed_at: { $gte: dayStart(from), $lte: dayEnd(to) } }, '-executed_at');
      const population = txns.rows.filter((t) => t.tenant_id === tenantId && !alerted.has(t.id) && !t.own_transfer);
      if (!population.length) throw httpError(422, 'No transactions without an alert were found in that period.');
      const picked = pickRandom(population, size);
      record = await E.QualitySample.create({
        ...base, population_size: population.length, sample_size: picked.length, status: 'open', truncated: txns.truncated || alerts.truncated,
        items: picked.map((t) => ({ ref_type: 'transaction', ref_id: t.id, outcome: 'pending', summary: money(t) })),
        metrics: { reviewed: 0, pending: picked.length }, findings_count: 0,
      });
    } else if (type === 'file_review') {
      const closed = await fetchAll(E.TmAlert, { tenant_id: tenantId, status: { $in: CLOSED }, updated_date: { $gte: dayStart(from), $lte: dayEnd(to) } }, '-updated_date');
      const population = closed.rows.filter((a) => a.tenant_id === tenantId);
      if (!population.length) throw httpError(422, 'No closed alerts were found in that period.');
      const picked = pickRandom(population, size);
      record = await E.QualitySample.create({
        ...base, population_size: population.length, sample_size: picked.length, status: 'open', truncated: closed.truncated,
        items: picked.map((a) => ({
          ref_type: 'alert', ref_id: a.id, outcome: 'pending', scenario_id: a.scenario_id, closed_by_user_id: a.closed_by_user_id,
          summary: `${a.title || a.id} · ${a.status}${a.close_reason ? ` · "${String(a.close_reason).slice(0, 120)}"` : ''}`,
        })),
        metrics: { reviewed: 0, pending: picked.length }, findings_count: 0,
      });
    } else {
      if (!scenario) throw httpError(400, 'scenario_id is required for an AI shadow sample');
      const alerts = await fetchAll(E.TmAlert, { tenant_id: tenantId, scenario_id: scenario.id, created_date: { $gte: dayStart(from), $lte: dayEnd(to) } }, '-created_date', 1000);
      const cmp = await shadowCompare(E, tenantId, alerts.rows.filter((a) => a.tenant_id === tenantId));
      if (!cmp.metrics.alerts) throw httpError(422, 'No AI-triaged alerts were found for this scenario in that period.');
      record = await E.QualitySample.create({
        ...base, population_size: alerts.rows.length, sample_size: cmp.metrics.alerts, status: 'completed', truncated: alerts.truncated,
        items: cmp.items.map((i) => ({ ...i, reviewer_user_id: auth.actorUserId, reviewed_at: new Date().toISOString() })),
        metrics: cmp.metrics, findings_count: cmp.findings, completed_at: new Date().toISOString(),
        completed_by_user_id: auth.actorUserId, completed_by_name: auth.actorName,
      });
      const owner = await scenarioOwner(E, tenantId, scenario);
      if (owner && cmp.metrics.missed > 0) {
        await E.Notification.create({
          tenant_id: tenantId, user_id: owner, type: 'tm_quality_finding', title: `AI shadow sample: ${cmp.metrics.missed} missed alert(s) in ${scenario.code}`,
          body: `AI proposed closing alerts in ${scenario.code} · ${scenario.name} that humans then escalated. Review the sample on the quality page.`,
          dedupe_key: `${owner}:${record.id}:shadow`,
        });
      }
    }

    await writeAudit(base44, auth, {
      tenantId, eventType: 'tm_quality_sample_created', before: {},
      after: { sample_id: record.id, sample_type: type, period_from: from, period_to: to, scenario_id: scenario?.id || null, sample_size: record.sample_size, population_size: record.population_size, status: record.status },
      notes: `${type.replace(/_/g, ' ')} sample created by ${auth.actorName}: ${record.sample_size} item(s) from a population of ${record.population_size}${record.truncated ? ` (population capped at ${MAX_POPULATION})` : ''}.`,
    });
    return Response.json({ ok: true, sample_id: record.id, sample: record });
  } catch (error) {
    console.error('runQualitySample error:', error?.message);
    return errorResponse(error);
  }
}