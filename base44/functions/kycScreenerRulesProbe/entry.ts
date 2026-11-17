// TEMPORARY probe (delete after use): times the trimmed rules stage on a real run's data, so the phase-1 change is
// measured against the exact payload that used to overrun the background window.
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.52';
import { asList } from '../../shared/tmAuth.js';
import { anthropicKeyFor } from '../../shared/anthropicCredentials.js';
import { callClaude, DEFAULT_CLAUDE_MODEL, claudeClient } from '../../shared/claudeClient.js';
import { DEFAULT_RULES_GRID, normaliseScreening, profileFacts, rulesRequest } from '../../shared/kycScreener.js';
import { markIncomplete } from '../../shared/kycScreenerSteps.js';

export default async function (req) {
  try {
    const base44 = createClientFromRequest(req);
    const E = base44.asServiceRole.entities;
    const body = await req.json().catch(() => ({}));
    const run = asList(await E.KycScreenerRun.filter({ id: body.run_id }, undefined, 1))[0];
    if (!run) return Response.json({ error: 'run not found' }, { status: 404 });
    const tenant = asList(await E.Tenant.filter({ id: run.tenant_id }, undefined, 1))[0];
    const client = asList(await E.Client.filter({ id: run.client_id }, undefined, 1))[0];
    const kycCase = run.kyc_case_id ? asList(await E.KycCase.filter({ id: run.kyc_case_id }, undefined, 1))[0] || null : null;
    const parties = mapParties(run.progress?.parties || []);
    const profile = profileFacts({ client, kycCase, parties, outreachAnswers: [] });
    const raws = run.progress?.screening_raw || [];
    const screening = markIncomplete(normaliseScreening({ parties: raws.filter((x) => !x.failed) }, parties), raws);
    const req_ = rulesRequest({ profile, docRecord: run.doc_record, screening, grid: DEFAULT_RULES_GRID });
    const { key: apiKey } = await anthropicKeyFor(base44, run.tenant_id);
    const model = String(tenant.tm_settings?.claude_model || DEFAULT_CLAUDE_MODEL);
    const started = Date.now();
    const r = await callClaude({ ...req_, effort: 'low', maxTokens: 8000, timeoutMs: 120000, thinking: 'off', model, client: claudeClient(apiKey) });
    return Response.json({
      ms: Date.now() - started, model, ok: !!r.json?.disposition, disposition: r.json?.disposition,
      rule_outcomes: (r.json?.rule_outcomes || []).length, tokens: r.usage,
      prompt_chars: JSON.stringify(req_.content).length,
    });
  } catch (e) {
    return Response.json({ error: String(e?.message || e), code: e?.code }, { status: 500 });
  }
}

function mapParties(list) {
  return list.map((p) => ({ key: p.key, name: p.name, kind: p.kind, role: p.role, dob: p.dob, country: p.country }));
}