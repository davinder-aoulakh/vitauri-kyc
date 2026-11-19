// Guided conversation outreach: the document AI adapter (adapter contract 4, document.check). Structured output only; the raw
// model text is never shown to the client. Fails soft: { ok: false, error } and the checks become "Pending manual review".
import { aiLogFields } from './aiLog.js';

export const DOC_SCHEMA = {
  type: 'object',
  properties: {
    readable: { type: 'boolean' },
    document_type: { type: 'string' },
    issue_date: { type: 'string', description: 'YYYY-MM-DD, the date the document was issued or the statement date' },
    name_on_document: { type: 'string' },
    address_on_document: { type: 'string' },
    checks: { type: 'array', items: { type: 'object', properties: { name: { type: 'string' }, ok: { type: 'boolean' }, message: { type: 'string' } }, required: ['name', 'ok'] } },
  },
  required: ['readable', 'checks'],
};

export function docPrompt({ kind, label, checks, context }) {
  return `You check one document a customer uploaded during bank onboarding. Report facts only; you do not accept or reject anything.
Document requested: ${label || kind || 'document'}
Checks to report on (return one entry per check, with exactly these names): ${checks.map((c) => `"${c}"`).join(', ')}
Customer's name on their identity document: ${context?.id_name || 'unknown'}
Address the customer entered: ${context?.address_text || 'not given'}
Today: ${String(context?.today || new Date().toISOString()).slice(0, 10)}
Also read: the issue or statement date (YYYY-MM-DD), the person's name and the address as printed on the document.
For each check: ok true or false and a short neutral message (max 15 words). If you cannot tell, ok false and say why.`;
}

/**
 * Runs the AI check. invokeLLM = base44.asServiceRole.integrations.Core.InvokeLLM; log(row) writes an AiAgentRun row.
 * Returns { ok: true, checks, read: { issue_date, name_on_document, address_on_document, document_type, readable }, model_version } or { ok: false, error }.
 */
export async function checkDocumentAi({ invokeLLM, log, tenant, signedUrl, kind, label, checks, context }) {
  const prompt = docPrompt({ kind, label, checks, context });
  let out;
  try {
    try { out = await invokeLLM({ prompt, file_urls: [signedUrl], response_json_schema: DOC_SCHEMA, model: 'gemini_3_1_pro' }); } catch { out = await invokeLLM({ prompt, file_urls: [signedUrl], response_json_schema: DOC_SCHEMA }); }
  } catch (e) {
    return { ok: false, error: String(e?.message || e).slice(0, 200) };
  }
  if (!out || !Array.isArray(out.checks)) return { ok: false, error: 'No structured result' };
  if (log) await log({ agent_type: 'DocumentCheck', model_used: 'gemini_3_1_pro', prompt_version: 'outreach-doc-1', output_summary: `${label || kind}: ${out.checks.filter((c) => c.ok === false).length} check(s) not met`, ...aiLogFields({ prompt, output: out, tenant }) }).catch?.(() => {});
  return {
    ok: true, model_version: 'gemini_3_1_pro/outreach-doc-1',
    checks: out.checks.map((c) => ({ name: String(c.name || ''), ok: c.ok === true, message: String(c.message || '').slice(0, 200) })),
    read: { readable: out.readable !== false, document_type: out.document_type || null, issue_date: out.issue_date || null, name_on_document: out.name_on_document || null, address_on_document: out.address_on_document || null },
  };
}
