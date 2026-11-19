// Guided conversation outreach: AI-assisted follow-up questions (spec 6.2, adapter contract 5). The phrasing is validated;
// on any problem the template's default text is used. The AI never decides what is asked, only how it is phrased.

const BANNED = /\b(risk|risky|screening|screened|sanction|sanctions|pep|suspicious|money laundering|laundering|compliance|fraud|terroris\w*|aml)\b/i;

/** One question, at most two sentences, short, no advice or judgement words, no mention of risk or screening. */
export function validatePhrasing(text) {
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  if (!t) return { ok: false, reason: 'empty' };
  if (t.length > 300) return { ok: false, reason: 'too long' };
  if ((t.match(/\?/g) || []).length !== 1 || !t.endsWith('?')) return { ok: false, reason: 'not exactly one question' };
  const sentences = t.split(/(?<=[.!?])\s+/).filter(Boolean);
  if (sentences.length > 2) return { ok: false, reason: 'more than two sentences' };
  if (BANNED.test(t)) return { ok: false, reason: 'mentions risk, screening or similar' };
  if (/\b(you should|we advise|we recommend|unfortunately)\b/i.test(t)) return { ok: false, reason: 'advice or judgement' };
  return { ok: true, text: t };
}

/** Approval mode for the conversation's risk class from the tenant settings: 'auto' or 'approval'. */
export function approvalMode(settings = {}, risk = 'medium') {
  const m = settings?.aiFollowUp?.[String(risk || 'medium').toLowerCase()];
  return m === 'auto' ? 'auto' : 'approval';
}

export const PHRASE_SCHEMA = { type: 'object', properties: { question: { type: 'string' } }, required: ['question'] };

export function phrasePrompt({ default_text, answer, block_label }) {
  return `You rephrase one follow-up question in a customer onboarding conversation of a bank.
Rules: exactly one question; at most two sentences; plain English; friendly and neutral; no advice; no judgement;
never mention risk, screening, sanctions, PEP, compliance, fraud or money laundering; do not invent facts; refer to the
customer's answer only as given. Return JSON {"question": "..."}.

Topic: ${block_label || ''}
Customer's answer: ${typeof answer === 'string' ? answer : JSON.stringify(answer)}
Default question: ${default_text}`;
}

/**
 * Phrases the follow-up with the platform LLM; returns { text, ai: bool, reason? }. invokeLLM(payload) is
 * base44.asServiceRole.integrations.Core.InvokeLLM (injected for tests).
 */
export async function phraseFollowUp(invokeLLM, input) {
  try {
    const out = await invokeLLM({ prompt: phrasePrompt(input), response_json_schema: PHRASE_SCHEMA });
    const v = validatePhrasing(out?.question);
    if (v.ok) return { text: v.text, ai: true, raw: out };
    return { text: input.default_text, ai: false, reason: v.reason, raw: out };
  } catch (e) {
    return { text: input.default_text, ai: false, reason: `AI call failed: ${String(e?.message || e).slice(0, 120)}` };
  }
}
