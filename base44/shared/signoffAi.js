// AI drafts for the sign-off flow: Compliance advice text and the approver's rationale. Claude with the tenant key when one is
// configured (Tenant Config → Integrations), else the platform LLM. Output is a DRAFT: the person edits and remains the author.
import { anthropicKeyFor } from './anthropicCredentials.js';
import { callClaude, claudeClient, DEFAULT_CLAUDE_MODEL } from './claudeClient.js';

const SYSTEM = 'You draft text for a KYC compliance file. Use only the facts given. Be concise, factual and neutral. Never invent facts, never decide on behalf of the person; write a draft they will edit. Write in English.';

async function generate(base44, tenant, prompt) {
  const { key } = await anthropicKeyFor(base44, tenant.id);
  if (key) {
    const r = await callClaude({ system: SYSTEM, content: [{ type: 'text', text: prompt }], model: String(tenant.tm_settings?.claude_model || DEFAULT_CLAUDE_MODEL), effort: 'low', maxTokens: 4000, client: claudeClient(key) });
    return { text: r.text, engine: r.model };
  }
  const out = await base44.asServiceRole.integrations.Core.InvokeLLM({ prompt: `${SYSTEM}\n\n${prompt}` });
  return { text: typeof out === 'string' ? out : out?.response || JSON.stringify(out), engine: 'platform-llm' };
}

export function caseFacts({ kycCase, client, route, advice, findings = [] }) {
  return {
    client: { name: client?.full_name, type: client?.client_type, country: client?.registered_country || client?.country_of_residence },
    case_type: kycCase.case_type, existing_classification: route.existing, proposed_classification: route.proposed, effective_classification: route.effective,
    route: route.reason, downgrade_motivation: kycCase.downgrade_motivation || null, analyst_note: kycCase.submitted_note || null,
    purpose: String(kycCase.purpose_nature_text || '').slice(0, 800),
    risk_rationale: String(kycCase.risk_assessment_meta?.consolidatedOverride?.justification || '').slice(0, 600) || null,
    compliance_advice: advice?.status === 'received' ? { outcome: advice.outcome, recommendation: advice.recommendation, conditions: advice.conditions || [], text: String(advice.advice_html || '').replace(/<[^>]+>/g, ' ').slice(0, 1500) } : null,
    open_findings: findings.filter((f) => f.status !== 'resolved').map((f) => f.text).slice(0, 10),
  };
}

export async function draftAdvice(base44, tenant, facts, headings) {
  const prompt = `Draft Compliance advice on this KYC case as simple HTML (<h4>, <p>, <ul><li>). Use these headings in order: ${headings.join(', ')}. End with a clear recommendation sentence (approve, decline or reclassify) and list any conditions as bullet points under the last heading.\n\nCase facts (JSON):\n${JSON.stringify(facts, null, 1)}`;
  const r = await generate(base44, tenant, prompt);
  return { html: r.text.replace(/^```(?:html)?\s*|```\s*$/g, '').trim(), engine: r.engine };
}

export async function draftRationale(base44, tenant, facts, decision) {
  const deviates = facts.compliance_advice && (
    (decision === 'approve' && facts.compliance_advice.recommendation !== 'Approve')
    || (['decline', 'terminate'].includes(decision) && facts.compliance_advice.recommendation === 'Approve'));
  const prompt = `Draft the approver's rationale (4-7 sentences, plain text) for the decision "${decision}" on this KYC case. Refer to the classification, the main risks, the evidence and the Compliance advice if present.${deviates ? ' The decision DEVIATES from the Compliance advice: include the sentence "This decision deviates from the Compliance advice because [add your reason]." and do not fill in the reason.' : ''}\n\nCase facts (JSON):\n${JSON.stringify(facts, null, 1)}`;
  const r = await generate(base44, tenant, prompt);
  return { text: r.text.trim(), engine: r.engine, deviates: !!deviates };
}
