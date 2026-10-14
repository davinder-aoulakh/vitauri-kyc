// draftRuleFromText — turns a plain-language description into a Didit transaction-monitoring rule (AI agent 'TmRuleDraft').
// Auth: signed-in user with tmManageRules; tenant from the user. Requires tm_rules.
// The model output is validated server-side against the allow-list (tmRuleSchema); anything outside it is rejected with a clear error.
// Saves a TmRule in mode 'draft', version 1. Nothing is sent to Didit.
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.52';
import { isTmEnabled } from '../../shared/tmGuards.js';
import { authenticate, errorResponse, httpError, loadTenant, asList } from '../../shared/tmAuth.js';
import { writeAudit } from '../../shared/tmAudit.js';
import { runTmAgent } from '../../shared/tmAi.js';
import { MANAGE_ROLES, validateDefinition } from '../../shared/tmRuleSchema.js';
import { tenantThreshold } from '../../shared/tmRuleStarters.js';

const SCHEMA = {
  type: 'object',
  properties: {
    rule: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        description: { type: 'string' },
        category: { type: 'string', enum: ['finance', 'aml_ctf', 'anomaly_detection', 'fatf'] },
        evaluation_mode: { type: 'string', enum: ['ALL', 'ANY'] },
        scope: {
          type: 'object',
          properties: {
            transaction_types: { type: 'array', items: { type: 'string' } },
            directions: { type: 'array', items: { type: 'string' } },
          },
        },
        conditions: {
          type: 'array',
          items: { type: 'object', properties: { field: { type: 'string' }, operator: { type: 'string' }, value: {}, score: { type: 'number' } } },
        },
        aggregation: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              metric: { type: 'string' }, field: { type: 'string' }, operator: { type: 'string' }, value: { type: 'number' }, window: { type: 'string' },
              filters: { type: 'object' },
            },
          },
        },
        actions: {
          type: 'array',
          items: { type: 'object', properties: { type: { type: 'string' }, value: { type: 'number' }, tag_name: { type: 'string' } } },
        },
      },
    },
    rationale: { type: 'string', description: 'One or two sentences on how the rule reflects the description' },
    insufficient_evidence: { type: 'boolean' },
    missing: { type: 'array', items: { type: 'string' } },
  },
};

const SYSTEM_PROMPT = `You write transaction-monitoring rules for the Didit rules engine. Return ONE rule as JSON in "rule". Use ONLY this vocabulary; anything else is rejected.
Fields: amount, direction, currency, country, counterparty_country, payment_method, transaction_category, subject_vendor_data, counterparty_vendor_data, custom_values.<key>.
Condition operators: eq, neq, gt, gte, lt, lte, in, not_in, regex, fuzzy_match (fuzzy_match also needs "score" 0-100). Conditions look only at the single transaction being evaluated.
Aggregation (velocity over history, ALL entries must match): metric one of count, sum, min, max, avg, distinct_count; "field" for all but count; operator eq/ne/gt/gte/lt/lte with numeric "value"; window like 15m, 24h, 7d, 30d.
Aggregation "filters" narrow the history by equality only (use "__current__" to mean "same as the evaluated transaction"; always include {"subject_vendor_data":"__current__"}, and repeat direction/currency when the rule depends on them). There is no range filter: express "all under X" with metric max + operator lt.
Actions: {"type":"add_score","value":integer -100..100} and {"type":"add_tags","tag_name":"UPPER_SNAKE"}.
Directions are INBOUND or OUTBOUND. scope.transaction_types is ["finance"] unless told otherwise. category: finance, aml_ctf, anomaly_detection or fatf. evaluation_mode ALL unless the description says "any".
Keep scores moderate (20-50). Use the tenant threshold given in the input when the description mentions "the threshold" without a number. Title: 3-120 characters, plain English, no version number.
Example: "20+ inbound payments under 10,000 within 30 days" => conditions [{"field":"direction","operator":"eq","value":"INBOUND"},{"field":"amount","operator":"lt","value":10000}], aggregation [{"metric":"count","operator":"gte","value":20,"window":"30d","filters":{"subject_vendor_data":"__current__","direction":"INBOUND"}}], actions [{"type":"add_score","value":35}].
If the description is too vague to build a rule, set insufficient_evidence=true and list what is missing in "missing". Never invent data sources.`;

export default async function (req) {
  try {
    const base44 = createClientFromRequest(req);
    const body = await req.json();
    const auth = await authenticate(base44, req, body, { roles: MANAGE_ROLES, allowApiKey: false });
    const tenantId = auth.tenantId;
    const tenant = await loadTenant(base44, tenantId);
    if (!isTmEnabled(tenant, 'tm_rules')) throw httpError(403, 'Feature tm_rules is not enabled');
    const text = String(body.text || '').trim();
    if (text.length < 10) throw httpError(400, 'Describe the rule in at least a sentence');
    if (text.length > 2000) throw httpError(400, 'The description is too long (2000 characters at most)');

    const E = base44.asServiceRole.entities;
    let scenario = null;
    if (body.scenario_id) {
      scenario = asList(await E.TmScenario.filter({ tenant_id: tenantId, id: body.scenario_id }))[0];
      if (!scenario) throw httpError(404, 'Scenario not found');
    }
    const { output, ai_run_id } = await runTmAgent(base44, {
      tenantId, agent: 'TmRuleDraft', schema: SCHEMA, systemPrompt: SYSTEM_PROMPT, sources: [],
      input: {
        description: text, tenant_threshold: tenantThreshold(tenant), reporting_currency: tenant.tm_reporting_currency || 'USD',
        scenario: scenario ? { code: scenario.code, name: scenario.name, indicator_type: scenario.indicator_type, jurisdiction: scenario.jurisdiction, description: scenario.description } : null,
      },
    });
    if (output.insufficient_evidence || !output.rule) {
      const need = (output.missing || []).join('; ');
      throw httpError(422, `The assistant could not build a rule from that description${need ? `. It needs: ${need}` : ''}. Add more detail and try again.`);
    }
    const definition = validateDefinition(output.rule); // throws 422 listing unknown fields / operators etc.

    const rule = await E.TmRule.create({
      tenant_id: tenantId, name: definition.title, scenario_id: scenario?.id, version: 1, definition, nl_source: text, mode: 'draft',
      sync_status: 'not_synced', approval_status: 'not_requested', created_by_user_id: auth.actorUserId, owner_user_id: auth.actorUserId,
      lineage_id: crypto.randomUUID(), change_note: 'Drafted from a plain-language description',
    });
    await writeAudit(base44, auth, {
      tenantId, eventType: 'tm_rule_drafted', before: {}, after: { rule_id: rule.id, version: 1, mode: 'draft', ai_run_id },
      notes: `Rule "${definition.title}" drafted from text by ${auth.actorName} with AI assistance. It is a draft and was not sent to Didit.`,
    });
    return Response.json({ ok: true, rule_id: rule.id, rule, rationale: output.rationale || '', ai_run_id });
  } catch (error) {
    console.error('draftRuleFromText error:', error?.message);
    return errorResponse(error);
  }
}