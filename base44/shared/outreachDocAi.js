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

// read_extract (adapter contract 4): the extra fields read from a trade-register extract.
export const EXTRACT_PROPS = {
  legal_name: { type: 'string' }, registration_number: { type: 'string' }, legal_form: { type: 'string' }, status: { type: 'string' },
  registered_address: { type: 'string' }, activity: { type: 'string' }, registration_date: { type: 'string' },
  officers: { type: 'array', items: { type: 'object', properties: { name: { type: 'string' }, role: { type: 'string' }, authority_text: { type: 'string' } }, required: ['name'] } },
};

export function docPrompt({ kind, label, checks, context, extract }) {
  return `You check one document a customer uploaded during bank onboarding. Report facts only; you do not accept or reject anything.
Document requested: ${label || kind || 'document'}
Checks to report on (return one entry per check, with exactly these names): ${checks.map((c) => `"${c}"`).join(', ')}
Customer's name on their identity document: ${context?.id_name || 'unknown'}
Address the customer entered: ${context?.address_text || 'not given'}
Today: ${String(context?.today || new Date().toISOString()).slice(0, 10)}
Also read: the issue or statement date (YYYY-MM-DD), the person's name and the address as printed on the document.
For each check: ok true or false and a short neutral message (max 15 words). If you cannot tell, ok false and say why.${extract ? `
This is an extract of a trade register. Also read: legal_name, registration_number, legal_form, status, registered_address, activity, registration_date and the officers listed (name, role, authority text). Leave a field empty when it is not on the document; never guess.` : ''}`;
}

/**
 * Runs the AI check. invokeLLM = base44.asServiceRole.integrations.Core.InvokeLLM; log(row) writes an AiAgentRun row.
 * Returns { ok: true, checks, read: { issue_date, name_on_document, address_on_document, document_type, readable }, model_version } or { ok: false, error }.
 */
export async function checkDocumentAi({ invokeLLM, log, tenant, signedUrl, kind, label, checks, context, extract = false }) {
  const prompt = docPrompt({ kind, label, checks, context, extract });
  const schema = extract ? { ...DOC_SCHEMA, properties: { ...DOC_SCHEMA.properties, ...EXTRACT_PROPS } } : DOC_SCHEMA;
  let out;
  try {
    try { out = await invokeLLM({ prompt, file_urls: [signedUrl], response_json_schema: schema, model: 'gemini_3_1_pro' }); } catch { out = await invokeLLM({ prompt, file_urls: [signedUrl], response_json_schema: schema }); }
  } catch (e) {
    return { ok: false, error: String(e?.message || e).slice(0, 200) };
  }
  if (!out || !Array.isArray(out.checks)) return { ok: false, error: 'No structured result' };
  if (log) await log({ agent_type: 'DocumentCheck', model_used: 'gemini_3_1_pro', prompt_version: 'outreach-doc-1', output_summary: `${label || kind}: ${out.checks.filter((c) => c.ok === false).length} check(s) not met`, ...aiLogFields({ prompt, output: out, tenant }) }).catch?.(() => {});
  return {
    ok: true, model_version: 'gemini_3_1_pro/outreach-doc-1',
    checks: out.checks.map((c) => ({ name: String(c.name || ''), ok: c.ok === true, message: String(c.message || '').slice(0, 200) })),
    read: {
      readable: out.readable !== false, document_type: out.document_type || null, issue_date: out.issue_date || null, name_on_document: out.name_on_document || null, address_on_document: out.address_on_document || null,
      ...(extract ? Object.fromEntries(Object.keys(EXTRACT_PROPS).map((k) => [k, k === 'officers' ? (Array.isArray(out.officers) ? out.officers.filter((o) => o?.name).slice(0, 20) : []) : (out[k] ? String(out[k]).slice(0, 300) : null)])) : {}),
    },
  };
}
