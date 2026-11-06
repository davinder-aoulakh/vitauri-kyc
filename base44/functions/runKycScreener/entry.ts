// runKycScreener — Claude KYC Screener (after anthropics/financial-services kyc-screener, Apache-2.0) for one client, NP or ORG.
// Auth: signed-in user of the client's tenant with createRunCase. Body:
//   { client_id, kyc_case_id? }               -> starts a run; returns { run_id } at once, the work continues in the background
//   { action: 'signed_url', run_id, kind }    -> short-lived link to the run's xlsx / pdf
// Sends the client documents (doc-reader stage, isolated), the Vitauri profile and named parties to Claude. Didit results
// are read from Vitauri only to compare; they are not sent to Claude. Nothing is written to the client file.
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.52';
import { waitUntil } from 'base44:runtime';
import { asList, errorResponse, httpError } from '../../shared/tmAuth.js';
import { aiLogFields } from '../../shared/aiLog.js';
import { outreachAnswers } from '../../shared/riskSignals.js';
import { callClaude, DEFAULT_CLAUDE_MODEL, claudeClient } from '../../shared/claudeClient.js';
import { runScreenerStages, namedParties, profileFacts, DEFAULT_RULES_GRID } from '../../shared/kycScreener.js';
import { compareScreening, compareRisk } from '../../shared/kycScreenerCompare.js';
import { buildScreenerXlsx, buildScreenerPdf } from '../../shared/kycScreenerExport.js';
import { KYC_SOURCE } from '../../shared/kycScreenerPrompts.js';

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

async function execute({ base44, E, user, tenant, client, kycCase, runId }) {
  const tenantId = tenant.id;
  const update = (p) => E.KycScreenerRun.update(runId, p).catch(() => {});
  try {
    const [links, docs, outreach, hits, kyb, grid] = await Promise.all([
      E.ClientRelatedPartyLink.filter({ tenant_id: tenantId, client_id: client.id }, undefined, 100).then(asList),
      loadDocuments(base44, E, tenantId, client.id),
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
    const model = String(tenant.tm_settings?.claude_model || DEFAULT_CLAUDE_MODEL);
    const ai = claudeClient();
    const callFn = (req) => callClaude({ ...req, model, client: ai });

    const result = await runScreenerStages({ docs, profile, parties, grid: grid.grid, callFn, onStage: (stage) => update({ stage }) });
    const comparison = {
      ...compareScreening({ client, parties, screening: result.screening, hits, idvAml: clientIdv, kyb }),
      risk: compareRisk(result.rules.risk_rating, client.risk_classification),
    };
    const run = {
      model: result.model, doc_record: result.docRecord, screening: result.screening, rules: result.rules, comparison,
      risk_rating: result.rules.risk_rating, disposition: result.rules.disposition, ran_at: new Date().toISOString(),
      documents_used: docs.map(({ ref, document_id, label, media_type, bytes, source }) => ({ ref, document_id, label, media_type, bytes, source })),
    };

    await update({ stage: 'export' });
    const stamp = run.ran_at.slice(0, 16).replace(/[:T]/g, '');
    const safe = String(client.full_name || 'client').replace(/[^A-Za-z0-9]+/g, '_').slice(0, 40);
    const xlsx = await buildScreenerXlsx({ run, client, tenant });
    const pdf = await buildScreenerPdf({ run, client, tenant });
    const [xlsxUrl, pdfUrl, xlsxHash, pdfHash] = await Promise.all([
      store(base44, xlsx, `escalation-${safe}-${stamp}.xlsx`, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'),
      store(base44, pdf, `kyc-screener-${safe}-${stamp}.pdf`, 'application/pdf'),
      sha256(xlsx), sha256(pdf),
    ]);

    await update({
      ...run, status: 'completed', stage: 'done', finished_at: new Date().toISOString(),
      xlsx_url: xlsxUrl, xlsx_hash: xlsxHash, pdf_url: pdfUrl, pdf_hash: pdfHash,
      tokens_input: result.usage.input_tokens, tokens_output: result.usage.output_tokens,
    });
    await E.AiAgentRun.create({
      tenant_id: tenantId, agent_type: 'KycScreener', case_id: kycCase?.id || undefined, model_used: result.model,
      prompt_version: `${KYC_SOURCE.repo}@${KYC_SOURCE.commit.slice(0, 12)}; grid ${grid.version}`,
      sources: [`client:${client.id}`, ...docs.map((d) => `document:${d.document_id}`)],
      output_summary: `${result.rules.risk_rating} · ${result.rules.disposition}: ${String(result.rules.summary || '').slice(0, 400)}`,
      tokens_input: result.usage.input_tokens, tokens_output: result.usage.output_tokens,
      ...aiLogFields({ prompt: { profile, parties: parties.map(({ key, name, role }) => ({ key, name, role })), documents: run.documents_used, grid: grid.grid }, output: { doc_record: result.docRecord, screening: result.screening, rules: result.rules }, tenant }),
    }).catch((e) => console.warn('AiAgentRun log failed:', e?.message));
    await E.AuditEvent.create({
      tenant_id: tenantId, client_id: client.id, case_id: kycCase?.id || undefined,
      actor_user_id: user.id, actor_name: user.full_name || user.email, actor_type: 'User', event_type: 'kyc_screener_run',
      before_state: {},
      after_state: { run_id: runId, model: result.model, risk_rating: result.rules.risk_rating, disposition: result.rules.disposition, parties: parties.length, documents: docs.length, comparison: comparison.totals },
      notes: `KYC Screener (Claude) recommends ${result.rules.risk_rating} risk, ${result.rules.disposition}. Didit vs Claude: ${comparison.totals.agree_clear + comparison.totals.agree_hit} agree, ${comparison.totals.claude_only} Claude only, ${comparison.totals.didit_only} Didit only, ${comparison.totals.review} to review. No change was made to the client file.`,
    }).catch(() => {});
  } catch (e) {
    const msg = String(e?.message || e).slice(0, 400);
    console.error('runKycScreener failed:', msg);
    await update({ status: 'failed', error: msg, finished_at: new Date().toISOString() });
    await E.AuditEvent.create({
      tenant_id: tenantId, client_id: client.id, actor_user_id: user.id, actor_name: user.full_name || user.email, actor_type: 'User',
      event_type: 'kyc_screener_failed', before_state: {}, after_state: { run_id: runId, error: msg }, notes: `KYC Screener run failed: ${msg}`,
    }).catch(() => {});
  }
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

    if (!body.client_id) throw httpError(400, 'client_id is required');
    const client = asList(await E.Client.filter({ tenant_id: tenantId, id: body.client_id }, undefined, 1))[0];
    if (!client || client.is_deleted) throw httpError(404, 'Client not found');
    const tenant = asList(await E.Tenant.filter({ id: tenantId }, undefined, 1))[0];
    if (!tenant) throw httpError(404, 'Tenant not found');
    claudeClient(); // fail fast when the API key is missing
    const running = asList(await E.KycScreenerRun.filter({ tenant_id: tenantId, client_id: client.id, status: 'running' }, '-created_date', 1))[0];
    if (running && Date.now() - new Date(running.created_date).getTime() < 15 * 60 * 1000) return Response.json({ ok: true, run_id: running.id, already_running: true });
    const kycCase = body.kyc_case_id
      ? asList(await E.KycCase.filter({ tenant_id: tenantId, id: body.kyc_case_id }, undefined, 1))[0] || null
      : asList(await E.KycCase.filter({ tenant_id: tenantId, client_id: client.id }, '-created_date', 1))[0] || null;

    const run = await E.KycScreenerRun.create({
      tenant_id: tenantId, client_id: client.id, kyc_case_id: kycCase?.id || undefined, status: 'running', stage: 'doc_reader',
      run_by_user_id: user.id, run_by_name: user.full_name || user.email, ran_at: new Date().toISOString(),
    });
    waitUntil(execute({ base44, E, user, tenant, client, kycCase, runId: run.id }));
    return Response.json({ ok: true, run_id: run.id });
  } catch (error) {
    console.error('runKycScreener error:', error?.message);
    return errorResponse(error);
  }
}
