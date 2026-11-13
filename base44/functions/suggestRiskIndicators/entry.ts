// suggestRiskIndicators — "AI Suggest" for the Risk Assessment indicator picker.
// Auth: signed-in user of the case's tenant (or Vitauri Ops). Body: { case_id, indicators: [{id,name,description,applies}] }.
// Reads what Vitauri already stores (outreach answers, screening hits, stored Didit AML results, SoF, OSINT, related
// parties), applies fixed triggers (declared PEP, crypto/gambling, open matches…) and asks the model for the rest.
// No Didit endpoints are called. Writes an AuditEvent with ids and counts only.
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.52';
import { asList, errorResponse, httpError } from '../../shared/tmAuth.js';
import { ruleSuggestions, signalsPrompt } from '../../shared/riskSignals.js';
import { loadRiskSignals } from '../../shared/riskFacts.js';

const SCOPES = ['NP_Client', 'ORG_Client', 'NP_Related_Party', 'ORG_Related_Party'];

async function invokeModel(base44, payload) {
  try {
    return await base44.asServiceRole.integrations.Core.InvokeLLM({ ...payload, model: 'gemini_3_1_pro' });
  } catch (e) {
    console.warn('suggestRiskIndicators: preferred model failed, retrying with the default model:', e?.message);
    return await base44.asServiceRole.integrations.Core.InvokeLLM(payload);
  }
}

export default async function (req) {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) throw httpError(401, 'Unauthorized');
    let body: any = {};
    try { body = await req.json(); } catch { body = {}; }
    if (!body.case_id) throw httpError(400, 'case_id is required');

    const indicators = (Array.isArray(body.indicators) ? body.indicators : [])
      .filter((i) => i && i.id && i.name)
      .slice(0, 100)
      .map((i) => ({
        id: String(i.id).slice(0, 64),
        name: String(i.name).slice(0, 120),
        description: String(i.description || '').slice(0, 300),
        applies: (Array.isArray(i.applies) ? i.applies : []).filter((s) => SCOPES.includes(s)),
      }));
    if (!indicators.length) throw httpError(400, 'indicators are required');

    const E = base44.asServiceRole.entities;
    const kycCase = asList(await E.KycCase.filter({ id: body.case_id }))[0];
    if (!kycCase) throw httpError(404, 'Case not found');
    const tenantId = user.tenant_id || user.data?.tenant_id;
    const role = user.app_role || user.data?.app_role;
    if (kycCase.tenant_id !== tenantId && role !== 'Vitauri Ops') throw httpError(403, 'Forbidden');
    const client = asList(await E.Client.filter({ id: kycCase.client_id }))[0];
    if (!client) throw httpError(404, 'Client not found');

    // Facts per entity (shared loader, also used by proposeRiskScores)
    const { signals } = await loadRiskSignals(E, kycCase, client);
    const rules = ruleSuggestions(signals, indicators);

    const typeOf = new Map(signals.entities.map((e) => [e.key, e.type]));
    const byId = new Map(indicators.map((i) => [i.id, i]));
    const taken = new Set(rules.map((r) => `${r.entity_key}|${r.indicator_id}`));

    let ai = [];
    let aiError = null;
    try {
      const result = await invokeModel(base44, {
        prompt: `You are a senior KYC/AML compliance analyst assessing customer risk indicators for one onboarding case.

FACTS PER ENTITY (key | name (type)); each fact shows its source in [brackets]. The client's own outreach answers are declarations made by the client and count as evidence:
${signalsPrompt(signals)}

AVAILABLE INDICATORS (id: name — description [applies to]):
${indicators.map((i) => `${i.id}: ${i.name} — ${i.description} [${i.applies.join(', ')}]`).join('\n')}

ALREADY SELECTED BY FIXED RULES (do not repeat these):
${rules.length ? rules.map((r) => `${r.entity_key} → ${r.indicator_id}`).join('\n') : '(none)'}

Select every OTHER indicator that the facts support for each entity. Rules:
- Only use an indicator for an entity whose type is in its [applies to] list.
- Every selection must quote the fact it rests on in "evidence" (copy the source and the relevant words). No fact → no selection.
- Consider: declared PEP status (own or via family/close associate), declared activities (crypto, cash, gambling, international transfers outside the EU…), high-risk or FATF grey/black-list countries, sector, unclear or weak source of funds, screening and AML matches that are not cleared, OSINT adverse findings, non-face-to-face onboarding (remote portal / ID&V without a meeting), complex ownership for organisations.
- Do not select an indicator just because data is missing, except non-face-to-face when onboarding was remote.
- "reason" is one short sentence for the analyst.
Return JSON only.`,
        response_json_schema: {
          type: 'object',
          properties: {
            suggestions: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  entity_key: { type: 'string' },
                  indicator_id: { type: 'string' },
                  reason: { type: 'string' },
                  evidence: { type: 'string' },
                },
              },
            },
          },
        },
      });
      ai = (result?.suggestions || []).filter((s) => {
        const ind = byId.get(s?.indicator_id);
        const type = typeOf.get(s?.entity_key);
        const k = `${s?.entity_key}|${s?.indicator_id}`;
        if (!ind || !type || !ind.applies.includes(type) || taken.has(k) || !String(s.evidence || '').trim()) return false;
        taken.add(k);
        return true;
      }).map((s) => ({
        entity_key: s.entity_key,
        indicator_id: s.indicator_id,
        reason: String(s.reason || '').slice(0, 300),
        evidence: String(s.evidence || '').slice(0, 300),
        origin: 'ai',
      }));
    } catch (e) {
      aiError = e?.message || 'AI unavailable';
      console.error('suggestRiskIndicators model error:', aiError);
    }

    const suggestions = [...rules, ...ai];
    await E.AuditEvent.create({
      tenant_id: kycCase.tenant_id, case_id: kycCase.id, client_id: client.id,
      actor_user_id: user.id, actor_name: user.full_name, actor_type: 'User', event_type: 'risk_indicators_suggested',
      before_state: {},
      after_state: {
        rule_suggestions: rules.map((r) => `${r.entity_key}:${r.indicator_id}`),
        ai_suggestions: ai.map((r) => `${r.entity_key}:${r.indicator_id}`),
        signals_used: signals.used,
        ai_failed: !!aiError,
      },
      notes: `Risk indicator suggestions: ${rules.length} from fixed rules, ${ai.length} from AI${aiError ? ' (AI unavailable)' : ''}.`,
    }).catch((e) => console.error('suggestRiskIndicators audit failed:', e?.message));

    return Response.json({ ok: true, suggestions, signals_used: signals.used, ai_failed: !!aiError });
  } catch (error) {
    console.error('suggestRiskIndicators error:', error?.message);
    return errorResponse(error);
  }
}
