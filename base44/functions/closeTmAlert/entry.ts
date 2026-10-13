// closeTmAlert — a HUMAN closes one TM alert (or bulk-closes alerts whose scenario is released for bulk close).
// Auth: signed-in user with tmWorkCase; tenant from the user. AI agents are rejected.
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.52';
import { isTmEnabled } from '../../shared/tmGuards.js';
import { authenticate, errorResponse, httpError, loadTenant, asList, WORK_ROLES } from '../../shared/tmAuth.js';
import { writeAudit } from '../../shared/tmAudit.js';
import { safeRecompute } from '../../shared/tmRisk.js';

const OUTCOMES = ['closed_false_positive', 'closed_no_action'];
const OPEN = ['new', 'triaged', 'in_review'];
const MAX_BULK = 100;

export default async function (req) {
  try {
    const base44 = createClientFromRequest(req);
    const body = await req.json();
    if (String(body.actor_type || '').toLowerCase() === 'ai_agent') throw httpError(403, 'AI agents cannot close alerts');
    const auth = await authenticate(base44, req, body, { roles: WORK_ROLES, allowApiKey: false });
    if (auth.actorType === 'AI_Agent') throw httpError(403, 'AI agents cannot close alerts');
    const tenantId = auth.tenantId;
    const E = base44.asServiceRole.entities;

    const outcome = body.outcome;
    if (!OUTCOMES.includes(outcome)) throw httpError(400, 'outcome must be closed_false_positive or closed_no_action');
    const reason = String(body.reason || '').trim();
    if (!reason) throw httpError(400, 'A reason is required');
    const ids = [...new Set(Array.isArray(body.alert_ids) ? body.alert_ids : body.alert_id ? [body.alert_id] : [])];
    if (!ids.length) throw httpError(400, 'alert_id or alert_ids is required');
    if (ids.length > MAX_BULK) throw httpError(400, `At most ${MAX_BULK} alerts can be closed at once`);

    const tenant = await loadTenant(base44, tenantId);
    if (!isTmEnabled(tenant, 'tm_core')) throw httpError(403, 'Feature tm_core is not enabled');

    const alerts = asList(await E.TmAlert.filter({ tenant_id: tenantId, id: { $in: ids } }, undefined, MAX_BULK));
    if (alerts.length !== ids.length) throw httpError(404, 'One or more alerts were not found');
    const notOpen = alerts.filter((a) => !OPEN.includes(a.status));
    if (notOpen.length) throw httpError(409, `${notOpen.length} alert(s) are no longer open`);

    // Bulk close gate: every alert's scenario must be released.
    if (ids.length > 1) {
      const scenarioIds = [...new Set(alerts.map((a) => a.scenario_id))];
      const scenarios = scenarioIds.every(Boolean)
        ? asList(await E.TmScenario.filter({ tenant_id: tenantId, id: { $in: scenarioIds } }, undefined, 200)) : [];
      const released = new Set(scenarios.filter((s) => s.bulk_close_released === true).map((s) => s.id));
      const blocked = alerts.filter((a) => !a.scenario_id || !released.has(a.scenario_id));
      if (blocked.length) throw httpError(403, `Bulk close is not released for ${blocked.length} of the selected alerts (their alert type has not been released after measurement).`);
    }

    const nowIso = new Date().toISOString();
    const profiles = new Map();
    for (const cid of [...new Set(alerts.map((a) => a.client_id))]) {
      profiles.set(cid, asList(await E.ExpectedProfile.filter({ tenant_id: tenantId, client_id: cid, status: 'approved' }, '-version', 1))[0] || null);
    }
    const ruleIds = [...new Set(alerts.flatMap((a) => a.rule_ids || []))];
    const rules = ruleIds.length ? asList(await E.TmRule.filter({ tenant_id: tenantId, id: { $in: ruleIds } }, undefined, 200)) : [];
    const ruleVersion = new Map(rules.map((r) => [r.id, r.version]));

    for (const a of alerts) {
      let modelVersion: string | undefined;
      if (a.ai_run_id) {
        const run = asList(await E.AiAgentRun.filter({ tenant_id: tenantId, id: a.ai_run_id }))[0];
        modelVersion = run?.model_version;
      }
      const snapshot: Record<string, unknown> = {
        profile_version: profiles.get(a.client_id)?.version,
        rule_versions: Object.fromEntries((a.rule_ids || []).map((id) => [id, ruleVersion.get(id) ?? null])),
        model_version: modelVersion,
      };
      Object.keys(snapshot).forEach((k) => snapshot[k] === undefined && delete snapshot[k]);
      await E.Decision.create({
        tenant_id: tenantId, subject_type: 'alert', subject_id: a.id, client_id: a.client_id, decision_type: 'alert_close',
        outcome, rationale: reason, decided_by_user_id: auth.actorUserId, decided_at: nowIso, snapshot,
      });
      await E.TmAlert.update(a.id, { status: outcome, close_reason: reason, closed_by_user_id: auth.actorUserId });
      await writeAudit(base44, auth, {
        tenantId, clientId: a.client_id, eventType: 'tm_alert_closed',
        before: { status: a.status, ai_proposal: a.ai_proposal || null }, after: { status: outcome, close_reason: reason, bulk: ids.length > 1 },
        notes: `Alert ${a.id} closed (${outcome}): ${reason}`,
      });
    }
    for (const cid of [...new Set(alerts.map((a) => a.client_id))]) {
      await safeRecompute(base44, { tenantId, tenant, clientId: cid, trigger: 'alert_closed', actor: auth });
    }
    return Response.json({ ok: true, closed: alerts.length, outcome });
  } catch (error) {
    console.error('closeTmAlert error:', error?.message);
    return errorResponse(error);
  }
}