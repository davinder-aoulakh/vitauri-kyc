// Claude API client for server-side agents (official Anthropic SDK). The key is the tenant's (Tenant Config → Integrations,
// stored in TenantSecret; see anthropicCredentials.js) and is never logged or returned. Forced tool_choice is not supported on Claude Opus 5.5, so JSON stages use structured
// outputs (output_config.format); stages with web search (incompatible with structured outputs) return a fenced JSON block.
import Anthropic from 'npm:@anthropic-ai/sdk@1.6.0';

export const DEFAULT_CLAUDE_MODEL = 'claude-opus-5-5';
export const WEB_SEARCH_TOOL = { type: 'web_search_20260209', name: 'web_search', max_uses: 15 };

export class ClaudeStageError extends Error {
  constructor(message, { status = 502, code = 'claude_error' } = {}) { super(message); this.status = status; this.code = code; }
}

/** One client per call site; apiKey comes from anthropicKeyFor(). */
export function claudeClient(apiKey) {
  if (!apiKey) throw new ClaudeStageError('No Anthropic API key is configured. A Tenant Admin can add it in Tenant Config → Integrations → Claude (Anthropic).', { status: 412, code: 'no_api_key' });
  return new Anthropic({ apiKey, maxRetries: 2, timeout: 10 * 60 * 1000 });
}

/** Cheap live check of a key + model (Models API). Returns { ok, model, error }. */
export async function checkClaudeKey(apiKey, model = DEFAULT_CLAUDE_MODEL) {
  try {
    const m = await claudeClient(apiKey).models.retrieve(model);
    return { ok: true, model: m?.id || model, display_name: m?.display_name || null };
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError) return { ok: false, error: 'The key was rejected by Anthropic (invalid or revoked).' };
    if (e instanceof Anthropic.PermissionDeniedError) return { ok: false, error: 'The key has no access to this model or workspace.' };
    if (e instanceof Anthropic.NotFoundError) return { ok: false, error: `Model ${model} is not available for this key.` };
    if (e instanceof Anthropic.APIError) return { ok: false, error: `Anthropic API error ${e.status}.` };
    return { ok: false, error: e?.code === 'no_api_key' ? e.message : 'Could not reach the Anthropic API.' };
  }
}

const textOf = (msg) => (msg.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();

/** Fenced or bare JSON object from text; null when none parses. */
export function extractJson(text) {
  const s = String(text || '');
  const fenced = [...s.matchAll(/```(?:json)?\s*([\s\S]*?)```/g)].map((m) => m[1]);
  const candidates = [...fenced.reverse(), s.slice(s.indexOf('{'), s.lastIndexOf('}') + 1)];
  for (const c of candidates) { try { const v = JSON.parse(c); if (v && typeof v === 'object') return v; } catch { /* next */ } }
  return null;
}

/**
 * One stage call. Returns { json, text, model, usage, stop_reason }.
 * schema: structured-output JSON schema (no tools allowed with it here). tools: server tools (web search) for free-text stages.
 * client: injectable for tests.
 */
export async function callClaude({ system, content, schema, tools, model = DEFAULT_CLAUDE_MODEL, effort = 'high', maxTokens = 32000, client }) {
  const c = client || claudeClient();
  const messages = [{ role: 'user', content }];
  const usage = { input_tokens: 0, output_tokens: 0 };
  let msg;
  for (let turn = 0; turn < 4; turn++) {
    const params = {
      model, max_tokens: maxTokens, system, messages,
      thinking: { type: 'adaptive' },
      output_config: { effort, ...(schema ? { format: { type: 'json_schema', schema } } : {}) },
      ...(tools?.length ? { tools } : {}),
      betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default',
    };
    try {
      msg = await c.beta.messages.stream(params).finalMessage();
    } catch (e) {
      if (e instanceof Anthropic.AuthenticationError) throw new ClaudeStageError('The Anthropic API key was rejected.', { status: 412, code: 'bad_api_key' });
      if (e instanceof Anthropic.RateLimitError) throw new ClaudeStageError('Claude is rate limited; try again in a minute.', { status: 429, code: 'rate_limited' });
      if (e instanceof Anthropic.APIError) throw new ClaudeStageError(`Claude API error ${e.status}: ${String(e.message).slice(0, 200)}`, { status: 502 });
      throw new ClaudeStageError(`Claude call failed: ${String(e?.message || e).slice(0, 200)}`);
    }
    usage.input_tokens += msg.usage?.input_tokens || 0;
    usage.output_tokens += msg.usage?.output_tokens || 0;
    if (msg.stop_reason !== 'pause_turn') break;
    messages.push({ role: 'assistant', content: msg.content }); // server tool paused: continue the same turn
  }
  if (msg.stop_reason === 'refusal') throw new ClaudeStageError(`Claude declined this request${msg.stop_details?.category ? ` (${msg.stop_details.category})` : ''}.`, { code: 'refusal' });
  if (msg.stop_reason === 'max_tokens') throw new ClaudeStageError('Claude ran out of output space for this stage.', { code: 'max_tokens' });
  const text = textOf(msg);
  let json = null;
  if (schema) { try { json = JSON.parse(text); } catch { json = null; } } else json = extractJson(text);
  return { json, text, model: msg.model || model, usage, stop_reason: msg.stop_reason, content: msg.content };
}
