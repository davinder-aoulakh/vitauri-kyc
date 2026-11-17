// runKycScreener — Claude KYC Screener (after anthropics/financial-services kyc-screener, Apache-2.0) for one client, NP or ORG.
// Auth: signed-in user of the client's tenant with createRunCase. Body:
//   { client_id, kyc_case_id? }               -> starts a run and its first step; returns { run_id } at once
//   { action: 'advance', run_id }             -> starts the next step when none is working (the panel calls this while it polls).
//                                                A run is done in short steps (doc reader, one screening call per party, rules, export):
//                                                one long background job is ended by the platform without a trace.
//   { action: 'signed_url', run_id, kind }    -> short-lived link to the run's xlsx / pdf
// Sends the client documents (doc-reader stage, isolated), the Vitauri profile and named parties to Claude. Didit results
// are read from Vitauri only to compare; they are not sent to Claude. Nothing is written to the client file.
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.52';
import { waitUntil } from 'base44:runtime';
import { asList, errorResponse, httpError } from '../../shared/tmAuth.js';
import { aiLogFields } from '../../shared/aiLog.js';
import { outreachAnswers } from '../../shared/riskSignals.js';
import { callClaude, DEFAULT_CLAUDE_MODEL, claudeClient } from '../../shared/claudeClient.js';
import { namedParties, profileFacts, DEFAULT_RULES_GRID, docReaderRequest, screeningRequest, rulesBatchRequest, rulesVerdictRequest, capDocRecord, normaliseScreening, SCREENING_SCHEMA } from '../../shared/kycScreener.js';
import { planAdvance, afterParty, afterRuleBatch, mergeRuleOutcomes, markIncomplete, isRunDead, HEARTBEAT_MS, MAX_STEP_ATTEMPTS, STEP_CALL_TIMEOUT_MS, SCREEN_MAX_SEARCHES, RULE_BATCH_SIZE, STEP_LABEL } from '../../shared/kycScreenerSteps.js';
import { compareScreening, compareRisk } from '../../shared/kycScreenerCompare.js';
import { buildScreenerXlsx, buildScreenerPdf } from '../../shared/kycScreenerExport.js';
import { KYC_SOURCE } from '../../shared/kycScreenerPrompts.js';
import { anthropicKeyFor } from '../../shared/anthropicCredentials.js';

const ROLES = ['Analyst', 'QC Reviewer', 'Compliance Officer', 'Manager', 'Director', 'Compliance Admin', 'Tenant Admin']; // createRunCase
const MAX_DOCS = 8;
const MAX_DOC_BYTES = 8 * 1024 * 1024;
const MAX_TOTAL_BYTES = 24 * 1024 * 1024;

async function sha256(bytes) {
  const h = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
function sniff(b) {
  if (b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46) return 'application/pdf';
  if (b[0] === 0x89 && b[1] === 0x50) return 'image/png';
  if (b[0] === 0xff && b[1] === 0xd8) return 'image/jpeg';
  if (b[0] === 0x52 && b[1] === 0x49 && b[8] === 0x57 && b[9] === 0x45) return 'image/webp';
  return null;
}
function b64(bytes) {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

async function loadDocuments(base44, E, tenantId, clientId) {
  const rows = asList(await E.Document.filter({ tenant_id: tenantId, client_id: clientId }, '-created_date', 40))
    .filter((d) => !d.is_deleted && d.file_url && !d.is_ai_generated);
  const out = [];
  let total = 0;
  for (const d of rows) {
    if (out.length >= MAX_DOCS) break;
    try {
      const url = /^https?:\/\//i.test(d.file_url) ? d.file_url
        : (await base44.asServiceRole.integrations.Core.CreateFileSignedUrl({ file_uri: d.file_url, expires_in: 600 }))?.signed_url;
      const res = await fetch(url);
      if (!res.ok) continue;
      const bytes = new Uint8Array(await res.arrayBuffer());
      const media = sniff(bytes);
      if (!media || bytes.length > MAX_DOC_BYTES || total + bytes.length > MAX_TOTAL_BYTES) continue;
      total += bytes.length;
      out.push({ ref: `DOC-${out.length + 1}`, document_id: d.id, label: `${d.doc_type || 'Document'} · ${d.file_name || ''}`.trim(), media_type: media, base64: b64(bytes), bytes: bytes.length, source: d.source || 'portal' });
    } catch { /* skip unreadable file */ }
  }
  return out;
}

async function rulesGrid(E, tenantId) {
  const cfg = asList(await E.AiPromptConfig.filter({ tenant_id: tenantId, agent_key: 'KycScreener' }).catch(() => [])).find((c) => c.is_active !== false && c.system_prompt);
  if (!cfg) return { grid: DEFAULT_RULES_GRID, version: 'default' };
  try {
    const g = JSON.parse(cfg.system_prompt);
    if (Array.isArray(g) && g.every((r) => r.id && r.text)) return { grid: g.slice(0, 60).map((r) => ({ id: String(r.id).slice(0, 20), text: String(r.text).slice(0, 500) })), version: `tenant:${cfg.id}` };
  } catch { /* not JSON: lines */ }
  const lines = String(cfg.system_prompt).split('\n').map((l) => l.trim()).filter(Boolean).slice(0, 60);
  return { grid: lines.map((t, i) => ({ id: `T${i + 1}`, text: t.slice(0, 500) })), version: `tenant:${cfg.id}` };
}

async function store(base44, bytes, name, type) {
  const up = await base44.asServiceRole.integrations.Core.UploadPrivateFile({ file: new File([bytes], name, { type }) });
  if (!up?.file_uri) throw new Error('The file could not be stored');
  return up.file_uri;
}

/** Everything a step needs besides the documents: parties, profile, Didit data for the comparison, rules grid. Cheap reads. */
async function loadContext(E, tenant, client, kycCase) {
  const tenantId = tenant.id;
  const [links, outreach, hits, kyb, grid] = await Promise.all([
    E.ClientRelatedPartyLink.filter({ tenant_id: tenantId, client_id: client.id }, undefined, 100).then(asList),
    E.OutreachRequest.filter({ tenant_id: tenantId, client_id: client.id }, '-created_date', 50).then(asList),
    E.ScreeningHit.filter({ tenant_id: tenantId, client_id: client.id }, '-created_date', 300).then(asList),
    client.client_type === 'ORG' ? E.KybVerification.filter({ tenant_id: tenantId, client_id: client.id }, '-created_date', 1).then((r) => asList(r)[0] || null) : Promise.resolve(null),
    rulesGrid(E, tenantId),
  ]);
  const rpIds = links.map((l) => l.related_party_id).filter(Boolean);
  const rps = rpIds.length ? asList(await E.RelatedParty.filter({ tenant_id: tenantId, id: { $in: rpIds } }, undefined, 100)) : [];
  const parties = namedParties(client, rps, links);
  // Didit ID&V AML per party (outreach items): the client's own requests and those addressed to each related party.
  const clientIdv = outreachAnswers(outreach.filter((o) => !o.related_party_id)).idv;
  for (const p of parties) {
    if (p.key === 'client') continue;
    const idv = outreachAnswers(outreach.filter((o) => o.related_party_id === p.key.slice(3))).idv[0];
    if (idv) p.didit_aml = idv;
  }
  const profile = profileFacts({ client, kycCase, parties, outreachAnswers: outreachAnswers(outreach.filter((o) => !o.related_party_id)).answers });
  return { parties, profile, hits, kyb, grid, clientIdv };
}

/**
 * One step of a run (background). Stores its result on the run and stops; the next "advance" call starts the next step.
 * A heartbeat is written every 20 s, so a step ended by the platform is recognised and retried instead of hanging for ever.
 */
async function runStep({ base44, E, user, tenant, client, kycCase, run, step, attempt, apiKey }) {
  const tenantId = tenant.id;
  const runId = run.id;
  const nowIso = () => new Date().toISOString();
  const started = Date.now();
  const update = (p) => E.KycScreenerRun.update(runId, p);
  const beat = setInterval(() => { E.KycScreenerRun.update(runId, { heartbeat_at: nowIso() }).catch(() => {}); }, HEARTBEAT_MS);
  const progress = { ...(run.progress || {}), step, attempts: attempt, active: true };
  const usage = { input_tokens: progress.usage?.input_tokens || 0, output_tokens: progress.usage?.output_tokens || 0 };
  const add = (u) => { usage.input_tokens += u?.input_tokens || 0; usage.output_tokens += u?.output_tokens || 0; };
  const idle = (next) => ({ ...next, active: false, usage, last_step: step, last_step_ms: Date.now() - started });
  try {
    const model = String(tenant.tm_settings?.claude_model || DEFAULT_CLAUDE_MODEL);
    const ai = claudeClient(apiKey);
    const callFn = (req) => callClaude({ effort: 'medium', maxTokens: 16000, timeoutMs: STEP_CALL_TIMEOUT_MS, ...req, model, client: ai });
    const ctx = await loadContext(E, tenant, client, kycCase);

    if (step === 'doc_reader') {
      const docs = await loadDocuments(base44, E, tenantId, client.id);
      const d = await callFn(docReaderRequest(docs));
      add(d.usage);
      const docRecord = capDocRecord(d.json);
      if (!docRecord) throw new Error('The doc-reader stage returned no valid record.');
      await update({
        doc_record: docRecord, model: d.model, stage: 'screening', heartbeat_at: nowIso(),
        documents_used: docs.map(({ ref, document_id, label, media_type, bytes, source }) => ({ ref, document_id, label, media_type, bytes, source })),
        progress: idle({ ...progress, step: 'screening', party_index: 0, attempts: 0, last_error: null, screening_raw: [],
          parties: ctx.parties.map(({ key, name, kind, role, dob, country }) => ({ key, name, kind, role, dob, country })) }),
      });
      return;
    }

    if (step === 'screening') {
      const list = progress.parties || [];
      const party = list[Number(progress.party_index) || 0];
      if (!party) { await update({ stage: 'rules', heartbeat_at: nowIso(), progress: idle({ ...progress, step: 'rules', attempts: 0 }) }); return; }
      let entry;
      try {
        const sc = await callFn({ ...screeningRequest([party], { maxUses: SCREEN_MAX_SEARCHES }), maxTokens: 8000 });
        add(sc.usage);
        let raw = sc.json;
        if (!raw?.parties) {
          const fix = await callFn({ system: 'Convert the screening notes into the JSON schema. Do not add facts.', content: [{ type: 'text', text: String(sc.text || '').slice(0, 40000) }], schema: SCREENING_SCHEMA, maxTokens: 4000 });
          add(fix.usage);
          raw = fix.json;
        }
        entry = (raw?.parties || []).find((x) => x.party_key === party.key) || (raw?.parties || [])[0];
        if (!entry?.checks) throw new Error('The screening stage returned no result for this party.');
      } catch (e) {
        const msg = String(e?.message || e).slice(0, 300);
        if (e?.code === 'no_api_key' || e?.code === 'bad_api_key') throw e; // no point in retrying or skipping
        if (attempt < MAX_STEP_ATTEMPTS) { await update({ heartbeat_at: nowIso(), progress: idle({ ...progress, last_error: msg }) }); return; } // retried by the next advance
        entry = { failed: true, error: msg };
      }
      const next = afterParty(progress, entry);
      await update({ stage: next.step, heartbeat_at: nowIso(), progress: idle(next) });
      return;
    }

    // The rules grid is applied in parts of RULE_BATCH_SIZE, each its own short call, and the verdict over the whole
    // grid is one last call: a large tenant grid never needs a single answer longer than a small one. Low reasoning
    // effort and a small answer budget keep every call to a few seconds; rulesRequest trims the screening detail.
    if (step === 'rules' || step === 'verdict') {
      const screening = markIncomplete(normaliseScreening({ parties: (progress.screening_raw || []).filter((x) => !x.failed) }, ctx.parties), progress.screening_raw || []);
      const grid = ctx.grid.grid;
      const from = Number(progress.rule_index) || 0;
      const batch = step === 'rules' ? grid.slice(from, from + RULE_BATCH_SIZE) : [];

      if (batch.length) {
        const part = Math.floor(from / RULE_BATCH_SIZE) + 1;
        const r = await callFn({ ...rulesBatchRequest({ profile: ctx.profile, docRecord: run.doc_record, screening, rules: batch, part, parts: Math.ceil(grid.length / RULE_BATCH_SIZE) }), effort: 'low', maxTokens: 4000, thinking: 'off' });
        add(r.usage);
        const outcomes = (r.json?.rule_outcomes || []).filter((o) => o?.rule_id);
        if (!outcomes.length) throw new Error(`The rules stage returned no outcome for rules part ${part}.`);
        const next = afterRuleBatch(progress, outcomes, grid.length);
        await update({ screening, stage: next.step, heartbeat_at: nowIso(), progress: idle(next) });
        return;
      }

      const v = await callFn({ ...rulesVerdictRequest({ profile: ctx.profile, docRecord: run.doc_record, screening, grid, outcomes: progress.rule_outcomes || [] }), effort: 'low', maxTokens: 6000, thinking: 'off' });
      add(v.usage);
      if (!v.json?.disposition) throw new Error('The rules stage returned no disposition.');
      const rules = {
        ...v.json,
        summary: String(v.json.summary || '').slice(0, 2000),
        rule_outcomes: mergeRuleOutcomes(grid, progress.rule_outcomes || []),
      };
      await update({ screening, rules, risk_rating: rules.risk_rating, disposition: rules.disposition, model: v.model || run.model, stage: 'export', heartbeat_at: nowIso(),
        progress: idle({ ...progress, step: 'export', attempts: 0, last_error: null }) });
      return;
    }

    // export: comparison with Didit, Excel, PDF, logs. No Claude call.
    const result = { model: run.model, docRecord: run.doc_record, screening: run.screening, rules: run.rules, usage };
    const comparison = {
      ...compareScreening({ client, parties: ctx.parties, screening: result.screening, hits: ctx.hits, idvAml: ctx.clientIdv, kyb: ctx.kyb }),
      risk: compareRisk(result.rules.risk_rating, client.risk_classification),
    };
    const docsUsed = run.documents_used || [];
    const full = {
      model: result.model, doc_record: result.docRecord, screening: result.screening, rules: result.rules, comparison,
      risk_rating: result.rules.risk_rating, disposition: result.rules.disposition, ran_at: run.ran_at || nowIso(), documents_used: docsUsed,
    };
    const stamp = full.ran_at.slice(0, 16).replace(/[:T]/g, '');
    const safe = String(client.full_name || 'client').replace(/[^A-Za-z0-9]+/g, '_').slice(0, 40);
    const xlsx = await buildScreenerXlsx({ run: full, client, tenant });
    const pdf = await buildScreenerPdf({ run: full, client, tenant });
    const [xlsxUrl, pdfUrl, xlsxHash, pdfHash] = await Promise.all([
      store(base44, xlsx, `escalation-${safe}-${stamp}.xlsx`, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'),
      store(base44, pdf, `kyc-screener-${safe}-${stamp}.pdf`, 'application/pdf'),
      sha256(xlsx), sha256(pdf),
    ]);
    const incomplete = (result.screening?.parties || []).filter((p) => p.incomplete).map((p) => p.name);
    await update({
      comparison, status: 'completed', stage: 'done', finished_at: nowIso(), heartbeat_at: nowIso(),
      xlsx_url: xlsxUrl, xlsx_hash: xlsxHash, pdf_url: pdfUrl, pdf_hash: pdfHash,
      tokens_input: usage.input_tokens, tokens_output: usage.output_tokens,
      progress: idle({ ...progress, step: 'done', attempts: 0, last_error: null }),
    });
    await E.AiAgentRun.create({
      tenant_id: tenantId, agent_type: 'KycScreener', case_id: kycCase?.id || undefined, model_used: result.model,
      prompt_version: `${KYC_SOURCE.repo}@${KYC_SOURCE.commit.slice(0, 12)}; grid ${ctx.grid.version}`,
      sources: [`client:${client.id}`, ...docsUsed.map((d) => `document:${d.document_id}`)],
      output_summary: `${result.rules.risk_rating} · ${result.rules.disposition}: ${String(result.rules.summary || '').slice(0, 400)}`,
      tokens_input: usage.input_tokens, tokens_output: usage.output_tokens,
      ...aiLogFields({ prompt: { profile: ctx.profile, parties: ctx.parties.map(({ key, name, role }) => ({ key, name, role })), documents: docsUsed, grid: ctx.grid.grid }, output: { doc_record: result.docRecord, screening: result.screening, rules: result.rules }, tenant }),
    }).catch((e) => console.warn('AiAgentRun log failed:', e?.message));
    await E.AuditEvent.create({
      tenant_id: tenantId, client_id: client.id, case_id: kycCase?.id || undefined,
      actor_user_id: user.id, actor_name: user.full_name || user.email, actor_type: 'User', event_type: 'kyc_screener_run',
      before_state: {},
      after_state: { run_id: runId, model: result.model, risk_rating: result.rules.risk_rating, disposition: result.rules.disposition, parties: ctx.parties.length, documents: docsUsed.length, comparison: comparison.totals, screening_incomplete: incomplete.length },
      notes: `KYC Screener (Claude) recommends ${result.rules.risk_rating} risk, ${result.rules.disposition}. Didit vs Claude: ${comparison.totals.agree_clear + comparison.totals.agree_hit} agree, ${comparison.totals.claude_only} Claude only, ${comparison.totals.didit_only} Didit only, ${comparison.totals.review} to review.${incomplete.length ? ` Screening could not be completed for ${incomplete.length} party(ies).` : ''} No change was made to the client file.`,
    }).catch(() => {});
  } catch (e) {
    const msg = String(e?.message || e).slice(0, 400);
    console.error(`runKycScreener step ${step} failed:`, msg);
    // A timeout is retried once by the next advance; anything else (or a second timeout) ends the run with the reason.
    if (e?.code === 'timeout' && attempt < MAX_STEP_ATTEMPTS) {
      await update({ heartbeat_at: nowIso(), progress: idle({ ...progress, last_error: msg }) }).catch(() => {});
    } else {
      await failRun({ E, user, tenantId, client, runId, progress: idle({ ...progress, last_error: msg }), msg: `${STEP_LABEL[step] || step}: ${msg}` });
    }
  } finally {
    clearInterval(beat);
  }
}

async function failRun({ E, user, tenantId, client, runId, progress, msg }) {
  await E.KycScreenerRun.update(runId, { status: 'failed', error: String(msg).slice(0, 400), finished_at: new Date().toISOString(), ...(progress ? { progress: { ...progress, active: false } } : {}) }).catch(() => {});
  await E.AuditEvent.create({
    tenant_id: tenantId, client_id: client.id, actor_user_id: user.id, actor_name: user.full_name || user.email, actor_type: 'User',
    event_type: 'kyc_screener_failed', before_state: {}, after_state: { run_id: runId, error: String(msg).slice(0, 400) }, notes: `KYC Screener run failed: ${String(msg).slice(0, 400)}`,
  }).catch(() => {});
}

/** Moves a run one step: starts the next step in the background, skips a party that could not be screened, or gives up. */
async function advance({ base44, E, user, tenant, client, kycCase, run, apiKey }) {
  const plan = planAdvance(run);
  if (plan.action === 'none' || plan.action === 'wait') return { state: plan.action, step: plan.step || null };
  if (plan.action === 'fail') {
    await failRun({ E, user, tenantId: tenant.id, client, runId: run.id, progress: run.progress, msg: plan.reason });
    return { state: 'failed' };
  }
  const now = new Date().toISOString();
  if (plan.action === 'skip_party') {
    const next = afterParty(run.progress || {}, { failed: true, error: plan.reason });
    await E.KycScreenerRun.update(run.id, { stage: next.step, heartbeat_at: now, progress: next });
    return { state: 'skipped_party', step: next.step };
  }
  const progress = { ...(run.progress || {}), step: plan.step, attempts: plan.attempt, active: true, started_at: now };
  await E.KycScreenerRun.update(run.id, { stage: plan.step, heartbeat_at: now, progress });
  waitUntil(runStep({ base44, E, user, tenant, client, kycCase, run: { ...run, progress }, step: plan.step, attempt: plan.attempt, apiKey }));
  return { state: 'started', step: plan.step, attempt: plan.attempt };
}

export default async function (req) {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me().catch(() => null);
    if (!user) throw httpError(401, 'Unauthorized');
    const role = user.app_role || user.data?.app_role;
    const tenantId = user.tenant_id || user.data?.tenant_id;
    if (!ROLES.includes(role) || !tenantId) throw httpError(403, 'You do not have permission to run the KYC Screener');
    const body = await req.json().catch(() => ({}));
    const E = base44.asServiceRole.entities;

    if (body.action === 'signed_url') {
      const run = asList(await E.KycScreenerRun.filter({ tenant_id: tenantId, id: body.run_id }, undefined, 1))[0];
      const uri = body.kind === 'xlsx' ? run?.xlsx_url : body.kind === 'pdf' ? run?.pdf_url : null;
      if (!uri) throw httpError(404, 'File not available');
      const res = await base44.asServiceRole.integrations.Core.CreateFileSignedUrl({ file_uri: uri, expires_in: 300 });
      return Response.json({ ok: true, signed_url: res.signed_url });
    }

    const tenant = asList(await E.Tenant.filter({ id: tenantId }, undefined, 1))[0];
    if (!tenant) throw httpError(404, 'Tenant not found');

    if (body.action === 'advance') {
      const run = asList(await E.KycScreenerRun.filter({ tenant_id: tenantId, id: body.run_id }, undefined, 1))[0];
      if (!run) throw httpError(404, 'Run not found');
      if (run.status !== 'running') return Response.json({ ok: true, state: 'none', status: run.status });
      const client = asList(await E.Client.filter({ tenant_id: tenantId, id: run.client_id }, undefined, 1))[0];
      if (!client || client.is_deleted) throw httpError(404, 'Client not found');
      const { key: apiKey } = await anthropicKeyFor(base44, tenantId);
      claudeClient(apiKey);
      const kycCase = run.kyc_case_id ? asList(await E.KycCase.filter({ tenant_id: tenantId, id: run.kyc_case_id }, undefined, 1))[0] || null : null;
      const res = await advance({ base44, E, user, tenant, client, kycCase, run, apiKey });
      return Response.json({ ok: true, run_id: run.id, ...res });
    }

    if (!body.client_id) throw httpError(400, 'client_id is required');
    const client = asList(await E.Client.filter({ tenant_id: tenantId, id: body.client_id }, undefined, 1))[0];
    if (!client || client.is_deleted) throw httpError(404, 'Client not found');
    const { key: apiKey } = await anthropicKeyFor(base44, tenantId);
    claudeClient(apiKey); // fail fast (412) when no key is configured for this tenant
    const running = asList(await E.KycScreenerRun.filter({ tenant_id: tenantId, client_id: client.id, status: 'running' }, '-created_date', 5));
    const live = running.find((r) => !isRunDead(r));
    if (live) return Response.json({ ok: true, run_id: live.id, already_running: true });
    // Runs nobody moved for a long time are closed, so they do not hang as "running" for ever.
    for (const r of running) await failRun({ E, user, tenantId, client, runId: r.id, progress: r.progress, msg: 'The run did not finish and was closed when a new run was started.' });
    const kycCase = body.kyc_case_id
      ? asList(await E.KycCase.filter({ tenant_id: tenantId, id: body.kyc_case_id }, undefined, 1))[0] || null
      : asList(await E.KycCase.filter({ tenant_id: tenantId, client_id: client.id }, '-created_date', 1))[0] || null;

    const run = await E.KycScreenerRun.create({
      tenant_id: tenantId, client_id: client.id, kyc_case_id: kycCase?.id || undefined, status: 'running', stage: 'doc_reader',
      run_by_user_id: user.id, run_by_name: user.full_name || user.email, ran_at: new Date().toISOString(),
      progress: { step: 'doc_reader', attempts: 0, active: false },
    });
    const res = await advance({ base44, E, user, tenant, client, kycCase, run, apiKey });
    return Response.json({ ok: true, run_id: run.id, ...res });
  } catch (error) {
    console.error('runKycScreener error:', error?.message);
    return errorResponse(error);
  }
}