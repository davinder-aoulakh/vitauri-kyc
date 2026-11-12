// runCaseQc — QC engine of "Draft Report & QC" (build spec §6.2): deterministic Case Check (qcRules.js) + Claude Report Check
// (qcReportCheck.js), max 3 rounds, findings by step, human-action decisions. QC never decides a hit or a score itself.
// Auth: signed-in createRunCase user of the case's tenant. Body: { case_id, action, ... }
//   status                                   -> latest run, findings, human actions, stale flag
//   run                                      -> starts round n (background); returns { run_id }
//   record_human_action { finding_id, choice, reasons, evidence_confirmed[] }
//   dismiss_finding { finding_id, reason }   -> minor findings only
// Every change writes an AuditEvent; secrets and document contents are never logged.
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.52';
import { waitUntil } from 'base44:runtime';
import { asList, errorResponse, httpError } from '../../shared/tmAuth.js';
import { ANALYST_ROLES, signoffConfig } from '../../shared/signoffRouting.js';
import { runCaseCheck, qcOutcome, validateHumanAction, QC_RULESET_VERSION, QC_MAX_ROUNDS, STEP_LABEL } from '../../shared/qcRules.js';
import { runReportCheck, REPORT_CHECK_PROMPT_VERSION } from '../../shared/qcReportCheck.js';
import { loadQcData, qcInputHash } from '../../shared/qcData.js';

const roleOf = (u) => u?.app_role || u?.data?.app_role;
const clip = (v, n = 2000) => String(v ?? '').trim().slice(0, n);
const RANK = { Low: 1, Medium: 2, High: 3, Unacceptable: 4 };
const OPEN = ['open', 'returned', 'needs_human'];

async function fetchBytes(base44, url) {
  const u = /^https?:\/\//i.test(url) ? url : (await base44.asServiceRole.integrations.Core.CreateFileSignedUrl({ file_uri: url, expires_in: 300 }))?.signed_url;
  const res = await fetch(u);
  if (!res.ok) return null;
  return new Uint8Array(await res.arrayBuffer());
}

export default async function (req) {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me().catch(() => null);
    if (!user) throw httpError(401, 'Unauthorized');
    if (!ANALYST_ROLES.includes(roleOf(user))) throw httpError(403, 'You do not have permission to run QC');
    const tenantId = user.tenant_id || user.data?.tenant_id;
    const body = await req.json().catch(() => ({}));
    const E = base44.asServiceRole.entities;
    const kycCase = asList(await E.KycCase.filter({ id: body.case_id }, undefined, 1))[0];
    if (!kycCase || kycCase.tenant_id !== tenantId) throw httpError(404, 'Case not found');
    const tenant = asList(await E.Tenant.filter({ id: tenantId }, undefined, 1))[0] || {};
    const cfg = signoffConfig(tenant);
    const actor = { id: user.id, name: user.full_name || user.email };
    const audit = (event_type, notes, after = {}) => E.AuditEvent.create({
      tenant_id: tenantId, case_id: kycCase.id, client_id: kycCase.client_id, actor_user_id: actor.id, actor_name: actor.name, actor_type: 'User',
      event_type, notes: clip(notes, 1000), after_state: after,
    }).catch((e) => console.warn('audit failed', e?.message));
    const runs = asList(await E.QcRun.filter({ tenant_id: tenantId, case_id: kycCase.id }, '-created_date', 10));
    const latest = runs[0] || null;
    const action = body.action || 'status';
    const now = () => new Date().toISOString();

    const loadFindings = (runId) => E.QcFinding.filter({ tenant_id: tenantId, qc_run_id: runId }, undefined, 300).then(asList);
    // Recompute a run's outcome after a human decision / dismissal and mirror it on the case.
    const settle = async (run) => {
      const findings = await loadFindings(run.id);
      const result = qcOutcome(findings);
      const certificate_id = result === 'passed' ? `QC-${String(kycCase.id).slice(-6).toUpperCase()}-${run.round || 1}-${String(run.input_snapshot_hash || '').slice(0, 8)}` : null;
      const counts = { blocker: 0, major: 0, minor: 0, human: 0, open: 0, resolved: 0 };
      for (const f of findings) {
        if (OPEN.includes(f.status)) { counts.open++; counts[f.severity]++; if (f.status === 'needs_human') counts.human++; } else counts.resolved++;
      }
      await E.QcRun.update(run.id, { result, certificate_id: certificate_id || undefined, summary: { ...(run.summary || {}), counts }, phase: result === 'passed' ? 'ready' : 'report_check' });
      const waiting = findings.some((f) => f.status === 'needs_human' && f.resolution_text === 'waiting_for_client');
      await E.KycCase.update(kycCase.id, { qc_state: waiting ? 'waiting_client' : result });
      return { result, certificate_id, counts, findings };
    };

    if (action === 'status') {
      const strictness = cfg.qc_strictness[kycCase.risk_classification || 'Medium'] || 'light';
      if (!latest) return Response.json({ ok: true, run: null, findings: [], actions: [], rounds_used: 0, max_rounds: QC_MAX_ROUNDS, strictness });
      const [findings, actions, data] = await Promise.all([
        loadFindings(latest.id),
        E.QcHumanAction.filter({ tenant_id: tenantId, case_id: kycCase.id }, '-created_date', 50).then(asList),
        loadQcData(E, tenantId, kycCase),
      ]);
      const stale = latest.result === 'passed' && (await qcInputHash(data)) !== latest.input_snapshot_hash;
      return Response.json({ ok: true, run: latest, findings, actions, stale, rounds_used: latest.round || runs.length, max_rounds: QC_MAX_ROUNDS, strictness, history: runs.map((r) => ({ id: r.id, round: r.round, result: r.result, started_at: r.started_at, finished_at: r.finished_at, model: r.model_version, ruleset: r.rule_set_version, report_check: r.report_check?.status, counts: r.summary?.counts })) });
    }

    if (action === 'run') {
      if (!['draft', undefined, null].includes(kycCase.signoff_status)) throw httpError(409, 'QC runs while the case is in draft');
      if (latest?.result === 'running' && Date.now() - new Date(latest.started_at || 0).getTime() < 10 * 60 * 1000) throw httpError(409, 'QC is already running');
      // A return / reopen (qc_state back to not_run) starts a new cycle of max 3 rounds; decisions carry over only within a cycle.
      const newCycle = !latest || ['not_run', undefined, null].includes(kycCase.qc_state);
      const cycleRuns = newCycle ? [] : runs.filter((r) => (r.round || 1) <= (latest.round || 1)).slice(0, latest.round || 1);
      const round = newCycle ? 1 : (latest.round || 0) + 1;
      if (round > QC_MAX_ROUNDS) throw httpError(409, `Maximum of ${QC_MAX_ROUNDS} QC rounds reached. Fix the findings manually or ask a manager to review.`);
      const data = await loadQcData(E, tenantId, kycCase);
      const strictness = cfg.qc_strictness[kycCase.risk_classification || 'Medium'] || 'light';
      const hash = await qcInputHash(data);
      const run = await E.QcRun.create({
        tenant_id: tenantId, case_id: kycCase.id, round, result: 'running', phase: 'case_check', started_at: now(), started_by: actor.id, started_by_name: actor.name,
        input_snapshot_hash: hash, rule_set_version: QC_RULESET_VERSION, prompt_version: REPORT_CHECK_PROMPT_VERSION, strictness,
        report_id: data.report?.id, report_version: data.report?.version_number, case_check_rounds: round, report_check_rounds: round,
      });
      await E.KycCase.update(kycCase.id, { qc_state: 'running' });
      await audit('qc.run_started', `QC round ${round} of ${QC_MAX_ROUNDS} started (${strictness}).`, { qc_run_id: run.id, round, strictness });

      const work = (async () => {
        try {
          // Earlier human decisions and dismissals carry over by fingerprint (delta check).
          const prevDecided = new Map();
          for (const r of cycleRuns) {
            for (const f of await loadFindings(r.id)) {
              if (['resolved', 'dismissed', 'carried'].includes(f.status) && f.fingerprint && !prevDecided.has(f.fingerprint) && (f.kind === 'human' || f.status !== 'resolved')) prevDecided.set(f.fingerprint, f);
            }
          }
          const caseFindings = runCaseCheck(data, strictness);
          await E.QcRun.update(run.id, { phase: 'report_check' });
          let rc;
          try {
            rc = await runReportCheck({ base44, tenant, data, pdfUrl: data.report?.pdf_url, fetchBytes: (u) => fetchBytes(base44, u) });
          } catch (e) {
            rc = { status: 'error', error: clip(e?.message, 300), findings: [] };
          }
          const reportFindings = (rc.findings || []).map((x) => ({
            code: x.code, fingerprint: `${x.code}:${clip(x.text, 80).toLowerCase()}`, step: x.step, step_label: STEP_LABEL[x.step], severity: x.severity, kind: 'auto',
            text: x.text, rule_ref: `${REPORT_CHECK_PROMPT_VERSION}/${x.code}`, owner: 'Report agent', report_value: x.report_value, case_value: x.case_value,
          }));
          if (rc.status !== 'done') {
            reportFindings.push({ code: 'R0', fingerprint: `R0:${rc.reason || 'error'}`, step: 10, step_label: STEP_LABEL[10], severity: 'minor', kind: 'auto',
              text: rc.summary || `Report Check could not run: ${rc.error || 'unknown error'}.`, rule_ref: `${REPORT_CHECK_PROMPT_VERSION}/R0`, owner: 'Report agent' });
          }
          const rows = [...caseFindings.map((x) => ({ ...x, check: 'case' })), ...reportFindings.map((x) => ({ ...x, check: 'report' }))].map((x) => {
            const prev = prevDecided.get(x.fingerprint);
            const status = prev ? 'carried' : x.kind === 'human' ? 'needs_human' : 'open';
            return {
              tenant_id: tenantId, case_id: kycCase.id, qc_run_id: run.id, round, check: x.check, code: x.code, fingerprint: x.fingerprint, kind: x.kind,
              step: x.step, step_label: x.step_label, severity: x.severity, text: clip(x.text, 1000), rule_ref: x.rule_ref, datapoint_ref: x.datapoint_ref || undefined,
              owner: x.owner, human: x.human || undefined, report_value: x.report_value || undefined, case_value: x.case_value || undefined, status,
              ...(prev ? { resolution_text: `Carried from round ${prev.round}: ${clip(prev.resolution_text, 400)}`, resolved_in_round: prev.round } : {}),
            };
          });
          if (rows.length) await E.QcFinding.bulkCreate(rows);
          await E.QcRun.update(run.id, { finished_at: now(), model_version: rc.engine || null, report_check: { status: rc.status, engine: rc.engine || null, summary: rc.summary || null, reason: rc.reason || null, error: rc.error || null, usage: rc.usage || null } });
          const s = await settle({ ...run });
          await audit('qc.run_completed', `QC round ${round}: ${s.result}. ${s.counts.blocker} blocker, ${s.counts.major} major, ${s.counts.minor} minor, ${s.counts.human} for a person. Report Check: ${rc.status}.`,
            { qc_run_id: run.id, result: s.result, counts: s.counts, certificate_id: s.certificate_id, report_check: rc.status, model: rc.engine || null, ruleset: QC_RULESET_VERSION });
        } catch (e) {
          console.error('runCaseQc background error:', e?.message);
          await E.QcRun.update(run.id, { result: 'error', error: clip(e?.message, 500), finished_at: now() }).catch(() => {});
          await E.KycCase.update(kycCase.id, { qc_state: 'failed' }).catch(() => {});
        }
      })();
      waitUntil(work);
      return Response.json({ ok: true, run_id: run.id, round });
    }

    if (action === 'record_human_action' || action === 'dismiss_finding') {
      const finding = asList(await E.QcFinding.filter({ tenant_id: tenantId, id: body.finding_id }, undefined, 1))[0];
      if (!finding || finding.case_id !== kycCase.id) throw httpError(404, 'Finding not found');
      if (!latest || finding.qc_run_id !== latest.id) throw httpError(409, 'This finding belongs to an earlier QC round');
      if (action === 'dismiss_finding') {
        if (finding.severity !== 'minor' || !OPEN.includes(finding.status)) throw httpError(409, 'Only open minor findings can be dismissed');
        if (clip(body.reason).length < 10) throw httpError(400, 'Give a reason (at least 10 characters)');
        await E.QcFinding.update(finding.id, { status: 'dismissed', resolution_text: clip(body.reason, 1000), resolved_by: actor.id, resolved_by_name: actor.name, resolved_at: now(), resolved_in_round: latest.round });
        await audit('qc.finding_dismissed', `Minor finding ${finding.code} dismissed: ${clip(body.reason, 300)}`, { finding_id: finding.id, code: finding.code });
        const s = await settle(latest);
        return Response.json({ ok: true, result: s.result });
      }
      if (finding.kind !== 'human' || finding.status !== 'needs_human') throw httpError(409, 'This finding does not need a human decision');
      const strictness = latest.strictness || 'light';
      const h = finding.human || {};
      const evidence = Array.isArray(body.evidence_confirmed) ? body.evidence_confirmed.map((v) => v === true) : [];
      const invalid = validateHumanAction({ choice: body.choice, reasons: body.reasons, evidence_confirmed: evidence, evidence_items: h.evidence_items || [] }, strictness);
      if (invalid) throw httpError(400, invalid);
      let outreachId;
      if (body.choice === 'Cannot decide yet') {
        const outreach = await E.OutreachRequest.create({
          tenant_id: tenantId, case_id: kycCase.id, client_id: kycCase.client_id, status: 'Draft', delivery_channel: 'Portal',
          message: 'We need some additional information to complete our review.',
          items: [{ item_id: `qc_${finding.id}`, label: 'Additional information', field_type: 'textarea', status: 'Pending', is_required: true, description: clip(h.outreach_question || h.question, 1000) }],
        });
        outreachId = outreach.id;
      }
      const ha = await E.QcHumanAction.create({
        tenant_id: tenantId, case_id: kycCase.id, qc_run_id: latest.id, finding_id: finding.id, kind: h.kind, question: h.question, comparison: h.comparison || [],
        evidence_items: h.evidence_items || [], evidence_confirmed: evidence, choice: body.choice, reasons: clip(body.reasons, 4000), strictness,
        decided_by: actor.id, decided_by_name: actor.name, decided_at: now(), outreach_id: outreachId,
        state: body.choice === 'Cannot decide yet' ? 'waiting_for_client' : 'done',
      });
      if (body.choice === 'Cannot decide yet') {
        await E.QcFinding.update(finding.id, { resolution_text: 'waiting_for_client' });
        await audit('qc.human_action', `Cannot decide yet on "${clip(h.question, 120)}": an outreach request to the client was drafted. Reason: ${clip(body.reasons, 300)}`, { finding_id: finding.id, choice: body.choice, outreach_id: outreachId });
      } else {
        await E.QcFinding.update(finding.id, { status: 'resolved', resolution_text: `${body.choice} — ${clip(body.reasons, 900)}`, resolved_by: actor.id, resolved_by_name: actor.name, resolved_at: now(), resolved_in_round: latest.round });
        await audit('qc.human_action', `${body.choice} on "${clip(h.question, 120)}". Reason: ${clip(body.reasons, 300)}`, { finding_id: finding.id, choice: body.choice, evidence_confirmed: evidence });
        if (body.choice === 'Not plausible') {
          const before = kycCase.risk_classification || null;
          if (!(RANK[before] >= 3)) {
            await E.KycCase.update(kycCase.id, { risk_classification: 'High' });
            await audit('qc.class_raised', `Classification raised ${before || '—'} → High after "Not plausible" on ${finding.code}. The route is recalculated.`, { from: before, to: 'High', finding_id: finding.id });
          }
          await E.QcFinding.create({
            tenant_id: tenantId, case_id: kycCase.id, qc_run_id: latest.id, round: latest.round, check: 'case', code: `${finding.code}-NP`, fingerprint: `${finding.fingerprint}:not_plausible`, kind: 'auto',
            step: finding.step, step_label: finding.step_label, severity: 'blocker', status: 'open', owner: 'Analyst', rule_ref: `${QC_RULESET_VERSION}/not_plausible`,
            text: `Judged not plausible: ${clip(finding.text, 300)} Resolve it (evidence, measures or EDD) and re-run QC, or reclassify.`,
          });
        }
      }
      const s = await settle(latest);
      return Response.json({ ok: true, result: s.result, action_id: ha.id, outreach_id: outreachId || null });
    }

    throw httpError(400, `Unknown action ${action}`);
  } catch (error) {
    console.error('runCaseQc error:', error?.message);
    return errorResponse(error);
  }
}
