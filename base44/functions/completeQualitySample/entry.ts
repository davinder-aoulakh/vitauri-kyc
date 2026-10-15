// completeQualitySample — reviewers record outcomes on an open sample, and a sample is completed.
//  { action: 'review', sample_id, ref_id, outcome, note?, scenario_id? }   below_the_line: ok | missed_signal (+ optional scenario); file_review: ok | wrongly_closed
//  { action: 'complete', sample_id }                                      needs every item reviewed; computes findings_count, writes the audit event,
//                                                                         notifies the scenario owner of each missed_signal finding.
// Auth: signed-in user with tmQuality; tenant from the user. File review: the person who closed the alert cannot review it.
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.52';
import { isTmEnabled } from '../../shared/tmGuards.js';
import { authenticate, errorResponse, httpError, loadTenant, asList } from '../../shared/tmAuth.js';
import { writeAudit } from '../../shared/tmAudit.js';
import { QUALITY_ROLES, REVIEW_OUTCOMES, loadSample, scenarioOwner } from '../../shared/tmQuality.js';

const counts = (items) => ({ reviewed: items.filter((i) => i.outcome !== 'pending').length, pending: items.filter((i) => i.outcome === 'pending').length });

async function review(ctx, sample, body) {
  const { E, auth, tenantId } = ctx;
  if (sample.status !== 'open') throw httpError(409, 'This sample is already completed');
  const allowed = REVIEW_OUTCOMES[sample.sample_type];
  if (!allowed) throw httpError(400, 'This sample type has no manual review');
  if (!allowed.includes(body.outcome)) throw httpError(400, `outcome must be ${allowed.join(' or ')}`);
  const note = String(body.note || '').trim().slice(0, 1000);
  if (body.outcome !== 'ok' && !note) throw httpError(400, 'A note is required when you record a finding');
  const items = [...(sample.items || [])];
  const idx = items.findIndex((i) => i.ref_id === body.ref_id);
  if (idx < 0) throw httpError(404, 'Item is not part of this sample');
  const item = items[idx];

  let scenarioId = item.scenario_id;
  if (sample.sample_type === 'file_review') {
    // Re-check against the live alert: the closer cannot review their own decision.
    const alert = asList(await E.TmAlert.filter({ tenant_id: tenantId, id: item.ref_id }))[0];
    if (!alert) throw httpError(404, 'Alert not found');
    if (alert.closed_by_user_id && alert.closed_by_user_id === auth.actorUserId) throw httpError(403, 'You closed this alert, so another reviewer must review it.');
    if (item.closed_by_user_id && item.closed_by_user_id === auth.actorUserId) throw httpError(403, 'You closed this alert, so another reviewer must review it.');
  } else if (body.scenario_id) {
    const sc = asList(await E.TmScenario.filter({ tenant_id: tenantId, id: body.scenario_id }))[0];
    if (!sc) throw httpError(404, 'Scenario not found');
    scenarioId = sc.id;
  }
  const before = { outcome: item.outcome, reviewer_user_id: item.reviewer_user_id || null };
  items[idx] = { ...item, outcome: body.outcome, note, scenario_id: scenarioId, reviewer_user_id: auth.actorUserId, reviewed_at: new Date().toISOString() };
  const metrics = { ...(sample.metrics || {}), ...counts(items) };
  await E.QualitySample.update(sample.id, { items, metrics, reviewer_user_id: sample.reviewer_user_id || auth.actorUserId });
  await writeAudit(ctx.base44, auth, {
    tenantId, eventType: 'tm_quality_item_reviewed', before,
    after: { sample_id: sample.id, ref_id: item.ref_id, outcome: body.outcome, scenario_id: scenarioId || null },
    notes: `${auth.actorName} marked ${item.ref_type} ${item.ref_id} as ${body.outcome} in sample ${sample.id}.${note ? ` Note: ${note}` : ''}`,
  });
  return { sample_id: sample.id, ...metrics };
}

async function complete(ctx, sample) {
  const { E, auth, tenantId } = ctx;
  if (sample.status !== 'open') throw httpError(409, 'This sample is already completed');
  const items = sample.items || [];
  const { pending } = counts(items);
  if (pending > 0) throw httpError(409, `${pending} item(s) still need a review before the sample can be completed`);
  const findings = items.filter((i) => i.outcome !== 'ok');
  const metrics = {
    ...(sample.metrics || {}), ...counts(items), findings: findings.length,
    missed_signal: findings.filter((i) => i.outcome === 'missed_signal').length,
    wrongly_closed: findings.filter((i) => i.outcome === 'wrongly_closed').length,
  };
  const completedAt = new Date().toISOString();
  await E.QualitySample.update(sample.id, {
    status: 'completed', findings_count: findings.length, metrics, completed_at: completedAt,
    completed_by_user_id: auth.actorUserId, completed_by_name: auth.actorName,
  });

  // Each missed_signal finding goes to the owner of its scenario (one notification per owner and sample).
  const missed = findings.filter((i) => i.outcome === 'missed_signal');
  const byScenario = new Map<string, number>();
  missed.forEach((i) => byScenario.set(i.scenario_id || '', (byScenario.get(i.scenario_id || '') || 0) + 1));
  const perOwner = new Map<string, { n: number; codes: string[] }>();
  let unowned = 0;
  for (const [sid, n] of byScenario) {
    const sc = sid ? asList(await E.TmScenario.filter({ tenant_id: tenantId, id: sid }))[0] : null;
    const owner = await scenarioOwner(E, tenantId, sc);
    if (!owner) { unowned += n; continue; }
    const cur = perOwner.get(owner) || { n: 0, codes: [] };
    cur.n += n; if (sc) cur.codes.push(sc.code);
    perOwner.set(owner, cur);
  }
  for (const [owner, v] of perOwner) {
    await E.Notification.create({
      tenant_id: tenantId, user_id: owner, type: 'tm_quality_finding', title: `${v.n} missed signal(s) found in a below-the-line sample`,
      body: `Independent review found ${v.n} transaction(s) that should have raised an alert${v.codes.length ? ` (${[...new Set(v.codes)].join(', ')})` : ''}. Review the sample on the quality page.`,
      dedupe_key: `${owner}:${sample.id}:missed`,
    });
  }
  await writeAudit(ctx.base44, auth, {
    tenantId, eventType: 'tm_quality_sample_completed', before: { status: 'open' },
    after: { sample_id: sample.id, status: 'completed', findings_count: findings.length, missed_signal: metrics.missed_signal, wrongly_closed: metrics.wrongly_closed, owners_notified: perOwner.size },
    notes: `${sample.sample_type.replace(/_/g, ' ')} sample completed by ${auth.actorName}: ${findings.length} finding(s) in ${items.length} item(s).${unowned ? ` ${unowned} missed signal(s) had no scenario owner to notify.` : ''}`,
  });
  return { sample_id: sample.id, findings_count: findings.length, owners_notified: perOwner.size, unowned_missed: unowned };
}

export default async function (req) {
  try {
    const base44 = createClientFromRequest(req);
    const body = await req.json();
    const auth = await authenticate(base44, req, body, { roles: QUALITY_ROLES, allowApiKey: false });
    const tenantId = auth.tenantId;
    const tenant = await loadTenant(base44, tenantId);
    if (!isTmEnabled(tenant, 'tm_quality')) throw httpError(403, 'Feature tm_quality is not enabled');
    const E = base44.asServiceRole.entities;
    const ctx = { base44, E, auth, tenantId };
    const sample = await loadSample(E, tenantId, body.sample_id);
    let result;
    if (body.action === 'review') result = await review(ctx, sample, body);
    else if (body.action === 'complete') result = await complete(ctx, sample);
    else throw httpError(400, 'action must be review or complete');
    return Response.json({ ok: true, ...result });
  } catch (error) {
    console.error('completeQualitySample error:', error?.message);
    return errorResponse(error);
  }
}