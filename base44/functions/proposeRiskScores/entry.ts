// proposeRiskScores — AI support for scoring the selected risk indicators of one relation (client or related party).
// Auth: signed-in user of the case's tenant (or Vitauri Ops). Body: { case_id, entity_key, indicators: [{id,name,description}] }.
// Reads what Vitauri already stores (same facts as suggestRiskIndicators, plus transaction analysis, document reviews and
// control measures), applies fixed MINIMUM scores for hard facts (riskScoring.js) and asks the model for a proposed score,
// rationale and the facts it rests on. It only proposes: nothing is written to the risk assessment; the analyst decides.
// No Didit endpoints are called. Logs an AiAgentRun (redacted) and an AuditEvent with ids, scores and counts only.
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.52';
import { asList, errorResponse, httpError } from '../../shared/tmAuth.js';
import { loadRiskSignals, addScoringFacts } from '../../shared/riskFacts.js';
import { scoreFloors, buildProposals, SCORES } from '../../shared/riskScoring.js';
import { aiLogFields } from '../../shared/aiLog.js';

const PROMPT_VERSION = 'risk-scoring-1';
const DEFAULT_SCALE = `Scoring scale:
- Low: no adverse fact; a standard, well-explained profile.
- Medium: a risk factor is present but explained, limited or mitigated.
- High: a material risk factor, or a weak / unsupported explanation; enhanced measures are needed.
- Unacceptable: outside risk appetite (for example a confirmed sanctions match).`;

async function invokeModel(base44, payload) {
  try {
    return { result: await base44.asServiceRole.integrations.Core.InvokeLLM({ ...payload, model: 'gemini_3_1_pro' }), model: 'gemini_3_1_pro' };
  } catch (e) {
    console.warn('proposeRiskScores: preferred model failed, retrying with the default model:', e?.message);
    return { result: await base44.asServiceRole.integrations.Core.InvokeLLM(payload), model: 'default' };
  }
}

export default async function (req) {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me().catch(() => null);
    if (!user) throw httpError(401, 'Unauthorized');
    let body: any = {};
    try { body = await req.json(); } catch { body = {}; }
    if (!body.case_id) throw httpError(400, 'case_id is required');
    const entityKey = String(body.entity_key || 'client');

    const indicators = (Array.isArray(body.indicators) ? body.indicators : [])
      .filter((i) => i && i.id && i.name).slice(0, 40)
      .map((i) => ({ id: String(i.id).slice(0, 64), name: String(i.name).slice(0, 120), description: String(i.description || '').slice(0, 300) }));
    if (!indicators.length) throw httpError(400, 'indicators are required');

    const E = base44.asServiceRole.entities;
    const kycCase = asList(await E.KycCase.filter({ id: body.case_id }))[0];
    if (!kycCase) throw httpError(404, 'Case not found');
    const tenantId = user.tenant_id || user.data?.tenant_id;
    const role = user.app_role || user.data?.app_role;
    if (kycCase.tenant_id !== tenantId && role !== 'Vitauri Ops') throw httpError(403, 'Forbidden');
    const client = asList(await E.Client.filter({ id: kycCase.client_id }))[0];
    if (!client) throw httpError(404, 'Client not found');
    const tenant = asList(await E.Tenant.filter({ id: kycCase.tenant_id }))[0] || null;

    const { signals } = await loadRiskSignals(E, kycCase, client);
    await addScoringFacts(E, kycCase, client, signals);
    const entity = signals.entities.find((e) => e.key === entityKey);
    if (!entity) throw httpError(404, 'This relation is not part of the case');
    // A related party is scored on its own facts; the client's facts are given as context (the relationship they are part of).
    const clientEntity = signals.entities.find((e) => e.key === 'client');
    const floors = scoreFloors(entity, indicators);

    const cfg = asList(await E.AiPromptConfig.filter({ tenant_id: kycCase.tenant_id, agent_key: 'RiskScoring' }).catch(() => [])).find((c) => c.is_active !== false && c.system_prompt);
    const factLines = (e) => (e.facts.length ? e.facts.map((f) => `- [${f.source}] ${f.text}`).join('\n') : '- (no facts on file)');
    const prompt = `You are a senior KYC/AML analyst. Propose a risk score for each selected risk indicator of ONE relation in a KYC file, using only the facts given. A human analyst decides; you propose.

${cfg?.system_prompt || DEFAULT_SCALE}

RELATION BEING SCORED: ${entity.label} (${entity.type})
FACTS ABOUT THIS RELATION (source in [brackets]; the client's own outreach answers are declarations and count as evidence):
${factLines(entity)}
${entity.key !== 'client' && clientEntity ? `\nCONTEXT — the client this relation belongs to: ${clientEntity.label} (${clientEntity.type})\n${factLines(clientEntity)}\n` : ''}
INDICATORS TO SCORE (id: name — description):
${indicators.map((i) => `${i.id}: ${i.name} — ${i.description}`).join('\n')}

MINIMUM SCORES SET BY FIXED RULES (never propose lower than these):
${Object.keys(floors).length ? Object.entries(floors).map(([id, f]) => `${id}: at least ${f.score} — ${f.reason}`).join('\n') : '(none)'}

Rules:
- Return exactly one entry per indicator id above.
- "score" is one of ${SCORES.join(', ')}.
- "evidence": the facts the score rests on, each copied with its source (e.g. "Outreach: Income Range — "€70.000 - €100.000""). If the file holds NO fact relevant to an indicator, return an empty evidence list and score "Low" — it will be shown as "no basis in the file".
- Weigh mitigating facts too (an adequate source of funds, an approved verification, a cleared hit, measures in place).
- Do not score an indicator higher only because information is missing; name what is missing in "missing" instead (what would change the score).
- "rationale": 2-3 factual sentences for the analyst, third person, no advice to approve or reject.
- "confidence": high when the facts are direct and consistent, medium when partial, low when thin or conflicting.
Return JSON only.`;

    let raw = [];
    let aiError = null;
    let model = null;
    try {
      const out = await invokeModel(base44, {
        prompt,
        response_json_schema: {
          type: 'object',
          properties: {
            proposals: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  indicator_id: { type: 'string' },
                  score: { type: 'string', enum: SCORES },
                  rationale: { type: 'string' },
                  evidence: { type: 'array', items: { type: 'string' } },
                  confidence: { type: 'string', enum: ['low', 'medium', 'high'] },
                  missing: { type: 'array', items: { type: 'string' } },
                },
              },
            },
          },
        },
      });
      model = out.model;
      raw = Array.isArray(out.result?.proposals) ? out.result.proposals : [];
      await E.AiAgentRun.create({
        tenant_id: kycCase.tenant_id, agent_type: 'RiskNarrative', case_id: kycCase.id, model_used: model, prompt_version: cfg ? `tenant:${cfg.id}` : PROMPT_VERSION,
        sources: [`case:${kycCase.id}`, `entity:${entityKey}`], output_summary: `Risk score proposals for ${indicators.length} indicator(s)`,
        ...aiLogFields({ prompt, output: out.result, tenant }),
      }).catch(() => {});
    } catch (e) {
      aiError = String(e?.message || 'AI unavailable').slice(0, 200);
      console.error('proposeRiskScores model error:', aiError);
    }

    const proposals = buildProposals(indicators, raw, floors, { model, at: new Date().toISOString() });
    await E.AuditEvent.create({
      tenant_id: kycCase.tenant_id, case_id: kycCase.id, client_id: client.id,
      actor_user_id: user.id, actor_name: user.full_name || user.email, actor_type: 'User', event_type: 'risk_scores_proposed',
      before_state: {},
      after_state: {
        entity_key: entityKey, proposals: proposals.map((p) => `${p.indicator_id}:${p.score || 'none'}${p.raised_by_rule ? ':rule' : ''}`),
        signals_used: signals.used, ai_failed: !!aiError,
      },
      notes: `AI risk score proposals for ${entity.label}: ${proposals.filter((p) => p.score).length} of ${proposals.length} indicator(s) with a proposed score${aiError ? ' (AI unavailable: rule minimums only)' : ''}.`,
    }).catch((e) => console.error('proposeRiskScores audit failed:', e?.message));

    return Response.json({ ok: true, proposals, signals_used: signals.used, ai_failed: !!aiError });
  } catch (error) {
    console.error('proposeRiskScores error:', error?.message);
    return errorResponse(error);
  }
}
