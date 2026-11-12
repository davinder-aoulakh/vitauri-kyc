// caseSignoffAction — every state change of Draft Report & QC, Compliance Advice and Final Report & Sign-off (build spec §4–§5).
// Auth: signed-in user of the case's tenant. Body: { case_id, action, ...payload }.
// Actions: route (read), submit, give_advice, ask_info, answer_info, return_to_analyst, confirm_advice, escalate, approve, return,
// decline, terminate, reopen, ai_draft_advice, ai_draft_rationale, freeze_report.
// Routing, permissions and transitions are pure (signoffRouting.js / signoffState.js). Every change writes an AuditEvent.
// The TM side effects of an approval (recordKycDecision, syncEdrOutcome, expected profile) stay in the UI, unchanged.
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.52';
import { asList, errorResponse, httpError } from '../../shared/tmAuth.js';
import { tenantUsers } from '../../shared/tmCaseCommon.js';
import { resolveRoute, signoffPermissions, signoffConfig, autoApprovalCheck, COMPLIANCE_ROLES, APPROVER_ROLES } from '../../shared/signoffRouting.js';
import { matchDeclined, subjectFromClient, requiresReview } from '../../shared/declinedMatch.js';
import { transition, routeKey, adviceOutdated, FINAL_STATES } from '../../shared/signoffState.js';
import { caseFacts, draftAdvice, draftRationale } from '../../shared/signoffAi.js';
import { loadQcData, qcInputHash } from '../../shared/qcData.js';

const CORE_STEPS = [1, 2, 3, 4, 5, 6, 7];
const NOT_REQ = [5, 7];
const stepDone = (kc, id) => (NOT_REQ.includes(id) && kc[`step_${id}_not_required`] === true) || kc[`step_${id}_status`] === 'complete' || (id === 2 && kc.step_2_not_required === true);
const roleOf = (u) => u?.app_role || u?.data?.app_role;
const clip = (v, n = 4000) => String(v ?? '').trim().slice(0, n);

async function sha256(bytes) {
  const h = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export default async function (req) {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me().catch(() => null);
    if (!user) throw httpError(401, 'Unauthorized');
    const tenantId = user.tenant_id || user.data?.tenant_id;
    const body = await req.json().catch(() => ({}));
    const E = base44.asServiceRole.entities;
    const kycCase = asList(await E.KycCase.filter({ id: body.case_id }, undefined, 1))[0];
    if (!kycCase || kycCase.tenant_id !== tenantId) throw httpError(404, 'Case not found');
    const [client, tenant, adviceRows] = await Promise.all([
      E.Client.filter({ tenant_id: tenantId, id: kycCase.client_id }, undefined, 1).then((r) => asList(r)[0] || null),
      E.Tenant.filter({ id: tenantId }, undefined, 1).then((r) => asList(r)[0] || {}),
      E.ComplianceAdvice.filter({ tenant_id: tenantId, case_id: kycCase.id }, '-created_date', 5).then(asList),
    ]);
    let advice = adviceRows.find((a) => !['superseded', 'returned'].includes(a.status)) || null;
    const cfg = signoffConfig(tenant);
    const actor = { id: user.id, name: user.full_name || user.email, role: roleOf(user) };
    const audit = (event_type, notes, after = {}, before = {}) => E.AuditEvent.create({
      tenant_id: tenantId, case_id: kycCase.id, client_id: kycCase.client_id, actor_user_id: actor.id, actor_name: actor.name, actor_type: 'User',
      event_type, notes: clip(notes, 1000), before_state: before, after_state: after,
    }).catch((e) => console.warn('audit failed', e?.message));

    // ---- Existing classification: snapshot once, from the client's latest approved earlier case (null for a new client) ----
    if (kycCase.existing_classification === undefined || kycCase.existing_classification === null) {
      if (!kycCase.route?.existing_checked) {
        const prior = asList(await E.KycCase.filter({ tenant_id: tenantId, client_id: kycCase.client_id, status: 'Approved' }, '-sign_off_approved_at', 10))
          .filter((c) => c.id !== kycCase.id && String(c.created_date || '') < String(kycCase.created_date || '9999'))[0];
        const existing = prior?.risk_classification || null;
        const snap = { existing_classification: existing || undefined, signoff_flow: 2, route: { ...(kycCase.route || {}), existing_checked: true } };
        await E.KycCase.update(kycCase.id, snap);
        Object.assign(kycCase, snap);
        if (existing) await audit('route.existing_snapshot', `Existing classification ${existing} taken from the approved case ${String(prior.id).slice(-6)}.`);
      }
    }

    // ---- Re-application check (spec §9): match this client and its people against declined/terminated records ----
    // A strong match on a Declined/Terminated record sets previously_declined (Compliance advice + at least Manager sign-off).
    let declinedMatches = [];
    if (client) {
      const [records, links] = await Promise.all([
        E.DeclinedRecord.filter({ tenant_id: tenantId }, '-created_date', 1000).then(asList).catch(() => []),
        E.ClientRelatedPartyLink.filter({ tenant_id: tenantId, client_id: client.id }, undefined, 100).then(asList).catch(() => []),
      ]);
      const others = records.filter((r) => r.case_id !== kycCase.id);
      if (others.length) {
        const rps = links.length ? asList(await E.RelatedParty.filter({ tenant_id: tenantId, id: { $in: links.map((l) => l.related_party_id) } }, undefined, 100).catch(() => [])) : [];
        declinedMatches = matchDeclined(subjectFromClient(client, rps), others);
      }
      const isDraft = ['draft', undefined, null].includes(kycCase.signoff_status);
      if (isDraft && requiresReview(declinedMatches) && !kycCase.previously_declined) {
        await E.KycCase.update(kycCase.id, { previously_declined: true });
        kycCase.previously_declined = true;
        await audit('intake.previously_declined_match', `Matches ${declinedMatches.filter((m) => m.strength === 'strong').length} declined/terminated record(s) on ${[...new Set(declinedMatches.flatMap((m) => m.matched_on))].slice(0, 4).join(', ')}. Compliance review is mandatory.`,
          { matches: declinedMatches.map((m) => ({ record_id: m.record_id, status: m.status, strength: m.strength, matched_on: m.matched_on })) });
      }
    }

    // ---- Route (always recomputed; class changes are logged and may outdate the advice) ----
    let route = resolveRoute(kycCase, cfg);
    const stored = kycCase.route || {};
    const routePatch = {};
    if (route.effective && (!stored.level || stored.level !== route.level || stored.needsAdvice !== route.needsAdvice || stored.effective !== route.effective || stored.proposed !== route.proposed)) {
      routePatch.route = { ...route, existing_checked: true, computed_at: new Date().toISOString() };
      routePatch.effective_classification = route.effective;
      if (stored.level) await audit('route.recalculated', `Route recalculated: ${route.reason}`, { level: route.level, needs_advice: route.needsAdvice, effective: route.effective }, { level: stored.level, needs_advice: stored.needsAdvice, effective: stored.effective });
    }
    // An escalation lifts the level to Senior until the case returns to draft.
    if (stored.escalated && kycCase.signoff_status === 'with_approver' && route.level === 'manager') route = { ...route, level: 'senior', approverRoles: APPROVER_ROLES.senior, escalated: true };
    if (advice && adviceOutdated(advice, route)) {
      await E.ComplianceAdvice.update(advice.id, { status: 'outdated' });
      advice = { ...advice, status: 'outdated' };
      routePatch.advice_state = 'outdated';
      await audit('advice.outdated', `Compliance advice is outdated: it was given for ${advice.valid_for_key}, the case is now ${routeKey(route)}.`);
    }
    if (Object.keys(routePatch).length) await E.KycCase.update(kycCase.id, routePatch);
    Object.assign(kycCase, routePatch);

    const perms = signoffPermissions(user, kycCase, route, advice);
    const action = body.action || 'route';
    // QC gate (phase 2): the latest QC round passed and the case data is unchanged since (same input hash). Legacy cases pass.
    const hasDraftReport = asList(await E.KycReport.filter({ tenant_id: tenantId, case_id: kycCase.id }, '-version_number', 5)).some((r) => r.status !== 'Superseded');
    let qcPassed = kycCase.qc_state === 'legacy';
    let qcStale = false;
    const needsGate = action === 'route' || action === 'submit';
    if (!qcPassed && needsGate && kycCase.qc_state === 'passed') {
      const lastRun = asList(await E.QcRun.filter({ tenant_id: tenantId, case_id: kycCase.id }, '-created_date', 1))[0];
      if (lastRun?.result === 'passed') {
        const hash = await qcInputHash(await loadQcData(E, tenantId, kycCase, client));
        qcPassed = hash === lastRun.input_snapshot_hash;
        qcStale = !qcPassed;
      }
    }
    if (action === 'submit' && qcStale) throw httpError(422, 'The case changed after QC passed. Re-run QC before submitting.');
    // Automatic approval eligibility (policy auto-1): only evaluated for a Low, analyst-level route in a tenant that enabled it.
    let auto = { eligible: false, conditions: [] };
    if (cfg.low_risk_mode === 'automatic' && route.level === 'analyst' && needsGate) {
      const lastRun = asList(await E.QcRun.filter({ tenant_id: tenantId, case_id: kycCase.id }, '-created_date', 1))[0];
      const fs = lastRun ? asList(await E.QcFinding.filter({ tenant_id: tenantId, qc_run_id: lastRun.id }, undefined, 300)) : [];
      const confirmedHits = asList(await E.ScreeningHit.filter({ tenant_id: tenantId, client_id: kycCase.client_id, status: 'Confirmed_Match' }, undefined, 5).catch(() => [])).length;
      auto = autoApprovalCheck({ cfg, route, kycCase, confirmedHits, qc: {
        passed: qcPassed && kycCase.qc_state !== 'legacy',
        humanFindings: fs.filter((f) => f.kind === 'human').length,
        openSerious: fs.filter((f) => ['open', 'returned', 'needs_human'].includes(f.status) && f.severity !== 'minor').length,
      } });
    }
    const isCompliance = COMPLIANCE_ROLES.includes(actor.role);
    if (action === 'declined_detail') {
      if (!isCompliance) throw httpError(403, 'Only Compliance can see the declined record details');
      const ids = declinedMatches.map((m) => m.record_id);
      const rows = ids.length ? asList(await E.DeclinedRecord.filter({ tenant_id: tenantId, id: { $in: ids } }, undefined, 50)) : [];
      await audit('intake.declined_detail_viewed', `Viewed ${rows.length} declined record(s) matching this case.`);
      return Response.json({ ok: true, records: rows.map((r) => ({ id: r.id, status: r.status, client_type: r.client_type, decided_at: r.decided_at, internal_reason: r.internal_reason, reporting_obligation_assessment: r.reporting_obligation_assessment, retention_until: r.retention_until || null, case_id: r.case_id })) });
    }
    if (action === 'route') {
      const lastDecision = asList(await E.SignOffDecision.filter({ tenant_id: tenantId, case_id: kycCase.id }, '-created_date', 1))[0] || null;
      return Response.json({ ok: true, route, perms, advice, qc_passed: qcPassed, qc_stale: qcStale, qc_state: kycCase.qc_state || 'not_run', has_draft_report: hasDraftReport,
        auto_eligible: auto.eligible, auto_conditions: auto.conditions, auto_policy: cfg.auto_approval_policy_version,
        declined_matches: declinedMatches.map((m) => ({ status: m.status, strength: m.strength, info_only: m.info_only, matched_on: m.matched_on, decided_at: m.decided_at })),
        can_view_declined: isCompliance,
        can_sample_review: !!lastDecision?.sample_review?.selected && lastDecision.sample_review.status === 'open' && actor.id !== kycCase.sign_off_submitted_by && [...APPROVER_ROLES.manager, ...COMPLIANCE_ROLES].includes(actor.role),
        pkyc_model: cfg.pkyc_model, incomplete_steps: CORE_STEPS.filter((id) => !stepDone(kycCase, id)), config: { compliance_advice_enabled: cfg.compliance_advice_enabled, low_risk_mode: cfg.low_risk_mode, qc_strictness: cfg.qc_strictness, advice_template_headings: cfg.advice_template_headings } });
    }

    // ---- AI drafts (no state change) ----
    if (action === 'ai_draft_advice') {
      if (!perms.canGiveAdvice) throw httpError(403, 'Only Compliance can draft advice');
      const r = await draftAdvice(base44, tenant, caseFacts({ kycCase, client, route, advice }), cfg.advice_template_headings);
      await audit('advice.ai_drafted', `AI drafted Compliance advice (${r.engine}).`);
      return Response.json({ ok: true, html: r.html, engine: r.engine });
    }
    if (action === 'ai_draft_rationale') {
      const r = await draftRationale(base44, tenant, caseFacts({ kycCase, client, route, advice }), String(body.decision || 'approve'));
      await audit('signoff.ai_rationale_drafted', `AI drafted a ${body.decision || 'approve'} rationale (${r.engine}).`);
      return Response.json({ ok: true, text: r.text, deviates: r.deviates, engine: r.engine });
    }

    // ---- Freeze the report version that belongs to the final decision ----
    if (action === 'freeze_report') {
      if (!FINAL_STATES.includes(kycCase.signoff_status)) throw httpError(409, 'Only a decided case has a final report');
      const report = asList(await E.KycReport.filter({ tenant_id: tenantId, case_id: kycCase.id, id: body.report_id }, undefined, 1))[0];
      if (!report?.pdf_url) throw httpError(404, 'Report not found');
      if (report.frozen_at) return Response.json({ ok: true, hash: report.hash, already: true });
      const url = /^https?:\/\//i.test(report.pdf_url) ? report.pdf_url : (await base44.asServiceRole.integrations.Core.CreateFileSignedUrl({ file_uri: report.pdf_url, expires_in: 300 }))?.signed_url;
      const bytes = new Uint8Array(await (await fetch(url)).arrayBuffer());
      const hash = await sha256(bytes);
      const status = { approved: 'Final', declined: 'Declined', terminated: 'Terminated' }[kycCase.signoff_status];
      const now = new Date().toISOString();
      await E.KycReport.update(report.id, { status, hash, frozen_at: now });
      const others = asList(await E.KycReport.filter({ tenant_id: tenantId, case_id: kycCase.id }, '-version_number', 50)).filter((r) => r.id !== report.id && !r.frozen_at && r.status !== 'Superseded');
      for (const o of others) await E.KycReport.update(o.id, { status: 'Superseded' });
      const decision = asList(await E.SignOffDecision.filter({ tenant_id: tenantId, case_id: kycCase.id }, '-created_date', 1))[0];
      if (decision && !decision.hash) await E.SignOffDecision.update(decision.id, { hash, report_version: report.version_number });
      await E.KycCase.update(kycCase.id, { current_report_version: report.version_number });
      await audit('case.frozen', `Report v${report.version_number} frozen as ${status} (SHA-256 ${hash.slice(0, 12)}…).`, { report_id: report.id, version: report.version_number, hash });
      return Response.json({ ok: true, hash, status });
    }

    // ---- Sample review of an automatic approval (a second person; never the submitter) ----
    if (action === 'sample_review') {
      const d = asList(await E.SignOffDecision.filter({ tenant_id: tenantId, case_id: kycCase.id }, '-created_date', 1))[0];
      if (!d?.sample_review?.selected || d.sample_review.status !== 'open') throw httpError(409, 'There is no open sample review on this case');
      if (actor.id === kycCase.sign_off_submitted_by) throw httpError(403, 'The analyst who submitted the case cannot review the sample');
      if (![...APPROVER_ROLES.manager, ...COMPLIANCE_ROLES].includes(actor.role)) throw httpError(403, 'A Manager, Director or Compliance user reviews samples');
      if (!['ok', 'issue'].includes(body.decision)) throw httpError(400, 'decision must be ok or issue');
      if (body.decision === 'issue' && clip(body.note).length < 10) throw httpError(400, 'Describe the issue (at least 10 characters)');
      const sr = { ...d.sample_review, status: body.decision, note: clip(body.note, 2000), reviewer_id: actor.id, reviewer_name: actor.name, reviewed_at: new Date().toISOString() };
      await E.SignOffDecision.update(d.id, { sample_review: sr });
      await audit('signoff.sample_reviewed', `Sample review of the automatic approval: ${body.decision === 'ok' ? 'OK' : `issue — ${clip(body.note, 300)}`}.`, { decision_id: d.id, decision: body.decision });
      if (body.decision === 'issue') {
        const us = await tenantUsers(E, tenantId).catch(() => []);
        const ids = [...new Set(us.filter((u) => u.is_active !== false && u.id !== actor.id && (u.id === kycCase.sign_off_submitted_by || u.id === kycCase.assigned_analyst_id || APPROVER_ROLES.senior.includes(roleOf(u)))).map((u) => u.id))];
        if (ids.length) await E.Notification.bulkCreate(ids.map((uid) => ({ tenant_id: tenantId, user_id: uid, type: 'sign_off_request', title: 'Sample review found an issue', body: clip(`Automatic approval of ${client?.full_name || 'a client'}: ${body.note}`, 400), link_case_id: kycCase.id, dedupe_key: `${uid}:${kycCase.id}:sample:${sr.reviewed_at.slice(0, 16)}` }))).catch(() => {});
      }
      return Response.json({ ok: true, sample_review: sr });
    }
    // ---- pKYC: apply the next review date from the review cycle ----
    if (action === 'set_next_review') {
      if (kycCase.signoff_status !== 'approved') throw httpError(409, 'Only an approved case sets the next review date');
      if (!perms.canSubmit) throw httpError(403, 'You cannot change the review date');
      const date = String(body.date || '').slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw httpError(400, 'date must be YYYY-MM-DD');
      if (!client) throw httpError(404, 'Client not found');
      await E.Client.update(client.id, { next_review_date: date });
      await audit('pkyc.next_review_set', `Next review date set to ${date} (was ${client.next_review_date || '—'}).`, { next_review_date: date }, { next_review_date: client.next_review_date || null });
      return Response.json({ ok: true, next_review_date: date });
    }

    // ---- State transitions ----
    const res = transition({ kycCase, route, advice, perms, qcPassed }, { type: action, by: actor, payload: body });
    if (res.error) throw httpError(res.status || 409, res.error);
    const now = new Date().toISOString();
    const patch = { ...res.patch };
    // Step statuses per transition.
    if (action === 'submit') {
      Object.assign(patch, { step_10_status: 'complete', step_8_status: 'in_progress', step_11_not_required: !route.needsAdvice, step_11_status: route.needsAdvice ? (res.to === 'with_approver' ? 'complete' : 'in_progress') : 'not_started' });
    } else if (action === 'give_advice' || action === 'confirm_advice') {
      Object.assign(patch, { step_11_status: 'complete' });
    } else if (['return', 'return_to_analyst'].includes(action)) {
      Object.assign(patch, { step_10_status: 'in_progress', step_8_status: 'not_started', qc_state: 'not_run', ...(action === 'return_to_analyst' ? { step_11_status: 'in_progress' } : {}) });
    } else if (action === 'reopen') {
      const steps = body.scope === 'full' ? CORE_STEPS : (Array.isArray(body.steps) ? body.steps.map(Number).filter((n) => CORE_STEPS.includes(n)) : []);
      for (const s of steps) patch[`step_${s}_status`] = 'in_progress';
      Object.assign(patch, { step_10_status: 'in_progress', step_11_status: route.needsAdvice ? 'in_progress' : 'not_started', qc_state: 'not_run' });
    }
    await E.KycCase.update(kycCase.id, patch);
    await audit(res.audit.event_type, res.audit.text, { signoff_status: res.to, level: route.level, effective: route.effective }, { signoff_status: kycCase.signoff_status || 'draft' });

    // ---- Effects ----
    const users = await tenantUsers(E, tenantId).catch(() => []);
    const active = users.filter((u) => u.is_active !== false && u.id !== actor.id);
    const notify = async (targets, title, text, kind) => {
      const ids = [...new Set(targets.map((u) => u.id))];
      if (!ids.length) return;
      await E.Notification.bulkCreate(ids.map((uid) => ({
        tenant_id: tenantId, user_id: uid, type: 'sign_off_request', title, body: clip(text, 400), link_case_id: kycCase.id,
        dedupe_key: `${uid}:${kycCase.id}:${kind}:${now.slice(0, 16)}`,
      }))).catch((e) => console.warn('notify failed', e?.message));
    };
    const name = client?.full_name || 'a client';
    let decision = null;
    for (const fx of res.effects) {
      if (fx === 'advice_requested') {
        if (advice && ['requested', 'info_needed', 'outdated'].includes(advice.status)) await E.ComplianceAdvice.update(advice.id, { status: 'requested', analyst_note: clip(body.note, 2000), requested_at: now, requested_by: actor.id });
        else advice = await E.ComplianceAdvice.create({ tenant_id: tenantId, case_id: kycCase.id, client_id: kycCase.client_id, status: 'requested', requested_at: now, requested_by: actor.id, analyst_note: clip(body.note, 2000), report_version_based_on: kycCase.current_report_version || null, questions: [] });
        await audit('advice.requested', 'Compliance advice requested.');
      }
      if (fx === 'advice_saved' && advice) {
        const attachments = (Array.isArray(body.attachments) ? body.attachments : []).slice(0, 20).map((a, i) => ({
          index: `C${i + 1}`, title: clip(a.title, 200), description: clip(a.description, 1000), file_url: clip(a.file_url, 1000), file_name: clip(a.file_name, 200), size: Number(a.size) || null,
        })).filter((a) => a.file_url && a.title);
        await E.ComplianceAdvice.update(advice.id, {
          status: 'received', outcome: body.outcome, recommendation: body.recommendation, advice_html: clip(body.advice_html, 60000), ai_assisted: !!body.ai_assisted,
          conditions: (Array.isArray(body.conditions) ? body.conditions : []).map((c) => clip(c, 500)).filter(Boolean).slice(0, 30), attachments,
          valid_for_key: routeKey(route), given_by: actor.id, given_by_name: actor.name, given_at: now,
        });
        // Spec: each condition becomes a proposed measure in Control Measures (deduplicated by text).
        const conds = (Array.isArray(body.conditions) ? body.conditions : []).map((c) => clip(c, 500)).filter(Boolean).slice(0, 30);
        if (conds.length) {
          const existingCm = asList(await E.ControlMeasure.filter({ tenant_id: tenantId, case_id: kycCase.id }, undefined, 200));
          const have = new Set(existingCm.map((m) => String(m.description || '').trim().toLowerCase()));
          for (const c of conds) {
            const description = `Compliance condition: ${c}`;
            if (have.has(description.toLowerCase())) continue;
            await E.ControlMeasure.create({ tenant_id: tenantId, case_id: kycCase.id, description, status: 'Open', owner_user_id: kycCase.assigned_analyst_id || undefined }).catch((e) => console.warn('control measure', e?.message));
          }
        }
        await audit('advice.submitted', `Advice ${body.outcome} · ${body.recommendation}${body.ai_assisted ? ' (AI-assisted draft, edited by the author)' : ''}; ${attachments.length} attachment(s).`, { outcome: body.outcome, recommendation: body.recommendation, ai_assisted: !!body.ai_assisted, attachments: attachments.map((a) => a.index) });
      }
      if (fx === 'advice_confirmed' && advice) await E.ComplianceAdvice.update(advice.id, { status: 'received', valid_for_key: routeKey(route), confirmed_at: now });
      if (action === 'ask_info' && advice) await E.ComplianceAdvice.update(advice.id, { status: 'info_needed', questions: [...(advice.questions || []), { question: clip(body.question, 2000), asked_by: actor.name, asked_at: now }] });
      if (action === 'answer_info' && advice) {
        const qs = [...(advice.questions || [])];
        const open = qs.map((q, i) => (!q.answer ? i : -1)).filter((i) => i >= 0).pop();
        if (open !== undefined) qs[open] = { ...qs[open], answer: clip(body.answer, 4000), answered_by: actor.name, answered_at: now };
        await E.ComplianceAdvice.update(advice.id, { status: 'requested', questions: qs });
      }
      if (action === 'return_to_analyst' && advice) await E.ComplianceAdvice.update(advice.id, { status: 'returned', returned_reason: clip(body.reason, 2000) });
      if (fx === 'decision') {
        const kind = { approve: 'Approved', return: 'Returned', decline: 'Declined', terminate: 'Terminated' }[action];
        const deviates = !!advice && advice.status === 'received' && (
          (action === 'approve' && advice.recommendation !== 'Approve') || (['decline', 'terminate'].includes(action) && advice.recommendation === 'Approve'));
        decision = await E.SignOffDecision.create({
          tenant_id: tenantId, case_id: kycCase.id, client_id: kycCase.client_id, kind, decided_by: actor.id, decided_by_name: actor.name, role: actor.role,
          acting_as: route.level, decided_at: now, rationale: clip(body.rationale, 8000), rationale_ai_assisted: !!body.rationale_ai_assisted, deviates_from_advice: deviates,
          reporting_obligation_assessment: body.reporting_obligation || undefined, neutral_letter_sent: !!body.neutral_letter, route,
          report_version: kycCase.current_report_version || null,
        });
      }
      if (fx === 'declined_record' && client) {
        const links = asList(await E.ClientRelatedPartyLink.filter({ tenant_id: tenantId, client_id: client.id }, undefined, 100));
        const rps = links.length ? asList(await E.RelatedParty.filter({ tenant_id: tenantId, id: { $in: links.map((l) => l.related_party_id) } }, undefined, 100)) : [];
        const identifiers = client.client_type === 'ORG'
          ? { name: client.full_name, registration_number: client.registration_number || null, registered_country: client.registered_country || null,
              people: rps.map((p) => ({ name: p.full_name, date_of_birth: p.date_of_birth || null, role: links.find((l) => l.related_party_id === p.id)?.role || null })) }
          : { name: client.full_name, date_of_birth: client.date_of_birth || null, document_numbers: [client.id_number].filter(Boolean), email: client.primary_contact_email || null,
              phone: client.primary_contact_phone || null, address: client.residential_address || null };
        await E.DeclinedRecord.create({
          tenant_id: tenantId, case_id: kycCase.id, client_id: client.id, client_type: client.client_type, status: action === 'decline' ? 'Declined, not onboarded' : 'Relationship terminated',
          identifiers, internal_reason: clip(body.rationale, 4000), reporting_obligation_assessment: body.reporting_obligation, neutral_letter_sent: !!body.neutral_letter, decided_by: actor.id, decided_at: now,
          ...(cfg.retention_months ? { retention_until: (() => { const d = new Date(now); d.setMonth(d.getMonth() + cfg.retention_months); return d.toISOString().slice(0, 10); })() } : {}),
        });
        await E.Client.update(client.id, { status: action === 'decline' ? 'Rejected' : 'Former' }).catch(() => {});
        if (action === 'terminate') {
          // Exit flow: a task for the analyst; Vitauri does not close accounts itself.
          const due = new Date(now); due.setDate(due.getDate() + 30);
          await E.ControlMeasure.create({ tenant_id: tenantId, case_id: kycCase.id, status: 'Open', owner_user_id: kycCase.assigned_analyst_id || kycCase.sign_off_submitted_by || undefined, due_date: due.toISOString().slice(0, 10),
            description: `Exit: offboard the relationship (close accounts and products, final statements${body.neutral_letter ? ', send the neutral letter' : ''}, stop monitoring when closed).` }).catch((e) => console.warn('exit task', e?.message));
          await audit('exit.started', 'Exit flow started: offboarding task created (due in 30 days).');
        }
      }
      if (fx === 'notify_compliance') await notify(active.filter((u) => COMPLIANCE_ROLES.includes(roleOf(u)) && u.id !== kycCase.sign_off_submitted_by), 'Compliance advice requested', `Case for ${name} (${route.effective}) needs Compliance advice.`, 'advice');
      if (fx === 'notify_approvers') {
        const adviser = advice?.given_by;
        await notify(active.filter((u) => route.approverRoles.includes(roleOf(u)) && !['Compliance Officer', 'Compliance Admin'].includes(roleOf(u)) && u.id !== (patch.sign_off_submitted_by || kycCase.sign_off_submitted_by) && u.id !== adviser),
          'Sign-off requested', `Case for ${name} (${route.effective}) needs ${route.level === 'senior' ? 'Senior Management' : 'Manager'} sign-off.`, 'signoff');
      }
      if (fx === 'notify_analyst') {
        const target = users.filter((u) => u.id === kycCase.sign_off_submitted_by || u.id === kycCase.assigned_analyst_id);
        await notify(target.filter((u) => u.id !== actor.id), `Case ${res.to.replace('_', ' ')}`, `${res.audit.text}`, 'analyst');
      }
    }
    // ---- Automatic approval (policy auto-1): straight after a submit that meets every condition ----
    if (action === 'submit' && res.to === 'with_approver' && auto.eligible) {
      const caseNow = { ...kycCase, ...patch };
      const sys = { id: 'system', name: `Automatic approval (${cfg.auto_approval_policy_version})`, role: 'System' };
      const ap = transition({ kycCase: caseNow, route, advice, perms: { ...perms, canApprove: true }, qcPassed }, { type: 'approve', by: sys, payload: {} });
      if (!ap.error) {
        const t = new Date().toISOString();
        await E.KycCase.update(kycCase.id, { ...ap.patch, sign_off_approved_by: 'system' });
        const selected = Math.random() * 100 < cfg.auto_approval_sample_pct;
        const rationale = `Approved automatically under policy ${cfg.auto_approval_policy_version}: ${auto.conditions.map((c) => c.label).join('; ')}.`;
        decision = await E.SignOffDecision.create({
          tenant_id: tenantId, case_id: kycCase.id, client_id: kycCase.client_id, kind: 'Approved', decided_by: 'system', decided_by_name: sys.name, role: 'System', acting_as: 'automatic',
          decided_at: t, rationale, auto_approved: true, policy_version: cfg.auto_approval_policy_version, auto_conditions: auto.conditions, route, report_version: kycCase.current_report_version || null,
          sample_review: { selected, status: selected ? 'open' : 'not_selected', sample_pct: cfg.auto_approval_sample_pct },
        });
        await audit('signoff.auto_approved', `${rationale}${selected ? ' Selected for sample review.' : ''}`, { decision_id: decision.id, policy: cfg.auto_approval_policy_version, sampled: selected });
        if (selected) {
          await notify(active.filter((u) => [...APPROVER_ROLES.manager, ...COMPLIANCE_ROLES].includes(roleOf(u)) && u.id !== kycCase.sign_off_submitted_by && u.id !== actor.id),
            'Sample review: automatic approval', `Case for ${name} was approved automatically and selected for a sample review.`, 'sample');
        }
        return Response.json({ ok: true, status: 'approved', auto_approved: true, sampled: selected, route, decision_id: decision.id });
      }
      console.warn('auto approval skipped:', ap.error);
    }
    return Response.json({ ok: true, status: res.to, route, decision_id: decision?.id || null });
  } catch (error) {
    console.error('caseSignoffAction error:', error?.message);
    return errorResponse(error);
  }
}
