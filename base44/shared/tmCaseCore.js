// manageTmCase actions: create, alerts, evidence, notes, escalation and decisions.
import { asList, httpError, WORK_ROLES } from './tmAuth.js';
import { safeRecompute } from './tmRisk.js';
import { proposeTriggers } from './edrTriggers.js';
import { collectEvidence } from './tmCaseEvidence.js';
import { riskAt, caseInputs } from './decisionSnapshot.js';
import {
  OPEN_CASE, WORKABLE_CASE, OPEN_ALERT, FOUR_EYES_ROLES, CO_ROLES, roleOf, tenantUsers, tlEntry, commit,
  clockPatch, distinct, caseClients, nextCaseRef,
} from './tmCaseCommon.js';

const KINDS = ['risk', 'ok', 'unclear', 'gap'];
const DECISION_TYPES = ['kyc_approval', 'aml_assessment', 'payment_release'];

const requireWorkable = (c) => { if (!WORKABLE_CASE.includes(c.status)) throw httpError(409, `Case is ${c.status}`); };
const requireOpen = (c) => { if (!OPEN_CASE.includes(c.status)) throw httpError(409, `Case is ${c.status}`); };
const needText = (v, label) => { const s = String(v || '').trim(); if (!s) throw httpError(400, `${label} is required`); return s; };

async function loadOpenAlerts(ctx, ids) {
  const alerts = asList(await ctx.E.TmAlert.filter({ tenant_id: ctx.tenantId, id: { $in: ids } }, undefined, 100));
  if (alerts.length !== ids.length) throw httpError(404, 'One or more alerts were not found');
  const bad = alerts.filter((a) => !OPEN_ALERT.includes(a.status) || a.tm_case_id);
  if (bad.length) throw httpError(409, `${bad.length} alert(s) are closed or already linked to a case`);
  return ids.map((id) => alerts.find((a) => a.id === id));
}

export async function createCase(ctx, _c, body) {
  const { E, auth, tenantId } = ctx;
  const ids = distinct(Array.isArray(body.alert_ids) ? body.alert_ids : []);
  if (!ids.length) throw httpError(400, 'alert_ids is required');
  if (ids.length > 50) throw httpError(400, 'At most 50 alerts per case');
  const alerts = await loadOpenAlerts(ctx, ids);

  const users = new Map((await tenantUsers(E, tenantId)).map((u) => [u.id, u]));
  const assignee = body.assigned_to_user_id || auth.actorUserId;
  if (!WORK_ROLES.includes(roleOf(users.get(assignee)))) throw httpError(400, 'The assignee must be a user who can work cases');
  const reviewer = body.four_eyes_user_id || null;
  if (reviewer) {
    if (reviewer === assignee) throw httpError(400, 'The four-eyes reviewer must be a different person than the assignee');
    if (!FOUR_EYES_ROLES.includes(roleOf(users.get(reviewer)))) throw httpError(400, 'The four-eyes reviewer needs a reviewer role');
  }

  const nowIso = new Date().toISOString();
  const primary = alerts[0].client_id;
  const base = { created_date: nowIso, escalated_to_co_at: null, co_decided_at: null };
  const created = await E.TmCase.create({
    tenant_id: tenantId, case_ref: await nextCaseRef(E, tenantId), primary_client_id: primary,
    client_ids: caseClients(primary, alerts.map((a) => a.client_id)), alert_ids: ids,
    title: String(body.title || '').trim() || alerts[0].title || 'TM case', status: 'open',
    assigned_to_user_id: assignee, ...(reviewer ? { four_eyes_user_id: reviewer } : {}), evidence: [],
    ...(await clockPatch(ctx, base, alerts[0])),
    timeline: [tlEntry(auth, 'created', `Case created from ${ids.length} alert(s) by ${auth.actorName}. Assigned to ${users.get(assignee)?.full_name || 'investigator'}${reviewer ? `, four-eyes reviewer ${users.get(reviewer)?.full_name}` : ''}.`)],
  });
  for (const a of alerts) await E.TmAlert.update(a.id, { tm_case_id: created.id, status: 'in_review', assigned_to_user_id: a.assigned_to_user_id || assignee });
  await ctx.base44.asServiceRole.entities.AuditEvent.create({
    tenant_id: tenantId, client_id: primary, actor_user_id: auth.actorUserId, actor_name: auth.actorName, actor_type: auth.actorType,
    event_type: 'tm_case_created', before_state: {}, after_state: { tm_case_id: created.id, case_ref: created.case_ref, alert_ids: ids, assigned_to_user_id: assignee, four_eyes_user_id: reviewer },
    notes: `Case ${created.case_ref} created from ${ids.length} alert(s).`,
  });
  return { tm_case_id: created.id, case_ref: created.case_ref };
}

export async function addAlerts(ctx, tmCase, body) {
  requireWorkable(tmCase);
  const ids = distinct(Array.isArray(body.alert_ids) ? body.alert_ids : []).filter((id) => !(tmCase.alert_ids || []).includes(id));
  if (!ids.length) throw httpError(400, 'No new alerts to add');
  const alerts = await loadOpenAlerts(ctx, ids);
  const alertIds = [...(tmCase.alert_ids || []), ...ids];
  const clientIds = caseClients(tmCase.primary_client_id, [...(tmCase.client_ids || []), ...alerts.map((a) => a.client_id)]);
  for (const a of alerts) await ctx.E.TmAlert.update(a.id, { tm_case_id: tmCase.id, status: 'in_review' });
  await commit(ctx, tmCase, { alert_ids: alertIds, client_ids: clientIds },
    tlEntry(ctx.auth, 'alerts_added', `${ids.length} alert(s) added by ${ctx.auth.actorName}.`),
    { type: 'tm_case_alerts_added', before: { alert_ids: tmCase.alert_ids }, after: { alert_ids: alertIds } });
  return { tm_case_id: tmCase.id };
}

export async function removeAlerts(ctx, tmCase, body) {
  requireWorkable(tmCase);
  const ids = distinct(Array.isArray(body.alert_ids) ? body.alert_ids : []).filter((id) => (tmCase.alert_ids || []).includes(id));
  if (!ids.length) throw httpError(400, 'No matching alerts to remove');
  const remaining = (tmCase.alert_ids || []).filter((id) => !ids.includes(id));
  if (!remaining.length) throw httpError(409, 'A case needs at least one alert');
  const E = ctx.E;
  const removed = asList(await E.TmAlert.filter({ tenant_id: ctx.tenantId, id: { $in: ids } }, undefined, 100));
  const kept = asList(await E.TmAlert.filter({ tenant_id: ctx.tenantId, id: { $in: remaining } }, undefined, 100));
  for (const a of removed) await E.TmAlert.update(a.id, { tm_case_id: '', status: a.ai_proposal ? 'triaged' : 'new' });
  const clientIds = caseClients(tmCase.primary_client_id, kept.map((a) => a.client_id), tmCase.network_client_ids || []);
  await commit(ctx, tmCase, { alert_ids: remaining, client_ids: clientIds },
    tlEntry(ctx.auth, 'alerts_removed', `${ids.length} alert(s) removed by ${ctx.auth.actorName}.`),
    { type: 'tm_case_alerts_removed', before: { alert_ids: tmCase.alert_ids }, after: { alert_ids: remaining } });
  return { tm_case_id: tmCase.id };
}

export async function collectCaseEvidence(ctx, tmCase) {
  requireOpen(tmCase);
  const { items, dropped_claims, ai_run_id } = await collectEvidence(ctx, tmCase);
  const kept = (tmCase.evidence || []).filter((e) => e.by === 'user' || e.accepted === true);
  const keptKeys = new Set(kept.map((e) => `${e.kind}:${e.text}`));
  const fresh = items.filter((i) => !keptKeys.has(`${i.kind}:${i.text}`));
  const gapCount = fresh.filter((i) => i.kind === 'gap').length;
  const patch = { evidence: [...kept, ...fresh], last_evidence_run_id: ai_run_id, ...(tmCase.status === 'open' ? { status: 'investigating' } : {}) };
  await commit(ctx, tmCase, patch,
    tlEntry(ctx.auth, 'evidence_collected', `AI proposed ${fresh.length} evidence item(s) (${gapCount} data gap(s)). All are pending review.`, { ref_id: ai_run_id }),
    { type: 'tm_case_evidence_collected', before: { evidence_count: (tmCase.evidence || []).length }, after: { evidence_count: patch.evidence.length, ai_run_id, dropped_claims } });
  return { tm_case_id: tmCase.id, proposed: fresh.length, gaps: gapCount };
}

function changeEvidence(tmCase, id, change) {
  const list = tmCase.evidence || [];
  const ev = list.find((e) => e.id === id);
  if (!ev) throw httpError(404, 'Evidence item not found');
  return { ev, next: list.map((e) => (e.id === id ? { ...e, ...change(e) } : e)) };
}

export async function acceptEvidence(ctx, tmCase, body) {
  requireOpen(tmCase);
  const { ev, next } = changeEvidence(tmCase, body.evidence_id, () => ({ accepted: true }));
  await commit(ctx, tmCase, { evidence: next },
    tlEntry(ctx.auth, 'evidence_accepted', `${ctx.auth.actorName} accepted evidence: ${ev.text.slice(0, 120)}`, { ref_id: ev.id }),
    { type: 'tm_case_evidence_accepted', before: { accepted: !!ev.accepted }, after: { accepted: true, evidence_id: ev.id } });
  return { tm_case_id: tmCase.id };
}

export async function editEvidence(ctx, tmCase, body) {
  requireOpen(tmCase);
  const text = needText(body.text, 'text');
  if (body.kind && !KINDS.includes(body.kind)) throw httpError(400, 'Invalid evidence kind');
  const { ev, next } = changeEvidence(tmCase, body.evidence_id, (e) => ({ text, kind: body.kind || e.kind, accepted: true, edited: true }));
  await commit(ctx, tmCase, { evidence: next },
    tlEntry(ctx.auth, 'evidence_edited', `${ctx.auth.actorName} edited and accepted evidence.`, { ref_id: ev.id }),
    { type: 'tm_case_evidence_edited', before: { text: ev.text, kind: ev.kind }, after: { text, kind: body.kind || ev.kind, evidence_id: ev.id } });
  return { tm_case_id: tmCase.id };
}

export async function addNote(ctx, tmCase, body) {
  const text = needText(body.text, 'text');
  await commit(ctx, tmCase, {}, tlEntry(ctx.auth, 'note', text), { type: 'tm_case_note_added', after: { note: text }, notes: `Note added to ${tmCase.case_ref}.` });
  return { tm_case_id: tmCase.id };
}

export async function escalateToCo(ctx, tmCase) {
  const { E, auth, tenantId } = ctx;
  requireWorkable(tmCase);
  if (tmCase.assigned_to_user_id && tmCase.assigned_to_user_id !== auth.actorUserId) throw httpError(403, 'Only the assigned investigator can escalate this case');
  const nowIso = new Date().toISOString();
  const patch = { escalated_to_co_at: nowIso, status: 'pending_co', ...(await clockPatch(ctx, { ...tmCase, escalated_to_co_at: nowIso })) };
  const officers = (await tenantUsers(E, tenantId)).filter((u) => CO_ROLES.includes(roleOf(u)) && u.id !== auth.actorUserId);
  if (officers.length) {
    await E.Notification.bulkCreate(officers.map((u) => ({
      tenant_id: tenantId, user_id: u.id, type: 'tm_escalation', is_read: false, link_tm_case_id: tmCase.id, link_client_id: tmCase.primary_client_id,
      title: `Case escalated: ${tmCase.case_ref}`, body: `${auth.actorName} escalated "${tmCase.title || tmCase.case_ref}" for a report decision.`,
    })));
  }
  await commit(ctx, tmCase, patch, tlEntry(auth, 'escalated', `Escalated to Compliance Officer by ${auth.actorName}.`),
    { type: 'tm_case_escalated_to_co', before: { status: tmCase.status }, after: { status: 'pending_co', escalated_to_co_at: nowIso, notified: officers.length } });
  return { tm_case_id: tmCase.id, notified: officers.length };
}

export async function coDecide(ctx, tmCase, body) {
  const { E, auth, tenantId, tenant } = ctx;
  if (!CO_ROLES.includes(auth.role)) throw httpError(403, 'Only a Compliance Officer can decide whether to report');
  if (!['report', 'no_report'].includes(body.decision)) throw httpError(400, 'decision must be report or no_report');
  const rationale = needText(body.rationale, 'rationale');
  if (tmCase.status !== 'pending_co') throw httpError(409, 'The case has not been escalated to a Compliance Officer');
  if (tmCase.assigned_to_user_id && tmCase.assigned_to_user_id === auth.actorUserId) throw httpError(403, 'Four-eyes: the decider must be a different person than the assigned investigator');

  const nowIso = new Date().toISOString();
  const report = body.decision === 'report';
  const status = report ? 'decided_report' : 'decided_no_report';
  const patch = { co_decision: body.decision, co_decided_at: nowIso, co_decided_by_user_id: auth.actorUserId, co_rationale: rationale, status, ...(await clockPatch(ctx, { ...tmCase, co_decided_at: nowIso })) };

  const alerts = asList(await E.TmAlert.filter({ tenant_id: tenantId, id: { $in: tmCase.alert_ids || [] } }, undefined, 100));
  for (const a of alerts.filter((x) => OPEN_ALERT.includes(x.status))) {
    await E.TmAlert.update(a.id, report ? { status: 'escalated' } : { status: 'closed_no_action', close_reason: rationale, closed_by_user_id: auth.actorUserId });
  }
  const profile = asList(await E.ExpectedProfile.filter({ tenant_id: tenantId, client_id: tmCase.primary_client_id, status: 'approved' }, '-version', 1))[0];
  await E.Decision.create({
    tenant_id: tenantId, subject_type: 'case', subject_id: tmCase.id, client_id: tmCase.primary_client_id, decision_type: 'report_decision',
    outcome: body.decision, rationale, decided_by_user_id: auth.actorUserId, decided_at: nowIso, four_eyes_user_id: tmCase.assigned_to_user_id,
    snapshot: {
      ...(profile ? { profile_version: profile.version, profile_id: profile.id } : {}),
      case: await caseInputs(E, tenantId, tmCase), dynamic_risk: await riskAt(E, tenantId, tmCase.primary_client_id),
    },
  });
  await commit(ctx, tmCase, patch, tlEntry(auth, 'co_decision', `Compliance Officer ${auth.actorName} decided: ${report ? 'report to FIU' : 'do not report'}. ${rationale}`),
    { type: 'tm_case_co_decision', before: { status: tmCase.status }, after: { status, co_decision: body.decision } });
  for (const cid of caseClients(tmCase.primary_client_id, tmCase.client_ids || [], tmCase.network_client_ids || [])) {
    await safeRecompute(ctx.base44, { tenantId, tenant, clientId: cid, trigger: 'tm_case_decision', actor: auth });
  }
  // A decision to report means the KYC file needs a fresh look: propose an event-driven review (unless one is linked already).
  if (report && !tmCase.kyc_edr_case_id) {
    try {
      const client = asList(await E.Client.filter({ tenant_id: tenantId, id: tmCase.primary_client_id }, undefined, 1))[0];
      if (client) {
        await proposeTriggers(E, {
          tenantId, client, sourceRef: `tm_case:${tmCase.id}`, actor: auth,
          findings: [{
            type: 'tm_case', key: `tm_case:${tmCase.id}:report`, before: {},
            after: { tm_case_id: tmCase.id, tm_case_ref: tmCase.case_ref || null, co_decision: 'report', tm_alert_ids: tmCase.alert_ids || [] },
            summary: `TM case ${tmCase.case_ref || tmCase.id} decided: report to FIU. Review the KYC file and expected profile.`,
          }],
        });
      }
    } catch (e) { console.warn('tm_case EDR trigger failed', e?.message || e); }
  }
  return { tm_case_id: tmCase.id, status };
}

export async function recordDecision(ctx, tmCase, body) {
  const { E, auth, tenantId } = ctx;
  if (!DECISION_TYPES.includes(body.decision_type)) throw httpError(400, 'decision_type must be kyc_approval, aml_assessment or payment_release');
  const outcome = needText(body.outcome, 'outcome');
  const rationale = needText(body.rationale, 'rationale');
  const profile = asList(await E.ExpectedProfile.filter({ tenant_id: tenantId, client_id: tmCase.primary_client_id, status: 'approved' }, '-version', 1))[0];
  const row = await E.Decision.create({
    tenant_id: tenantId, subject_type: 'case', subject_id: tmCase.id, client_id: tmCase.primary_client_id, decision_type: body.decision_type,
    outcome, rationale, decided_by_user_id: auth.actorUserId, decided_at: new Date().toISOString(), four_eyes_user_id: tmCase.four_eyes_user_id || undefined,
    snapshot: {
      ...(profile ? { profile_version: profile.version, profile_id: profile.id } : {}),
      case: await caseInputs(E, tenantId, tmCase), dynamic_risk: await riskAt(E, tenantId, tmCase.primary_client_id),
    },
  });
  const label = { kyc_approval: 'KYC decision', aml_assessment: 'AML assessment', payment_release: 'Payment release' }[body.decision_type];
  await commit(ctx, tmCase, {}, tlEntry(auth, 'decision', `${label} recorded by ${auth.actorName}: ${outcome}. ${rationale}`, { ref_id: row.id }),
    { type: 'tm_case_decision_recorded', after: { decision_id: row.id, decision_type: body.decision_type, outcome } });
  return { tm_case_id: tmCase.id, decision_id: row.id };
}