// Backtest a rule through Didit, count known reported cases it would have caught, and ask the AI for ONE tuning idea.
import { asList, httpError } from './tmAuth.js';
import { writeAudit } from './tmAudit.js';
import { backtestRule } from './diditTm.js';
import { runTmAgent } from './tmAi.js';
import { validateDefinition } from './tmRuleSchema.js';
import { errText } from './tmRuleSync.js';
import { matches, unsupportedReason } from './tmRuleEval.js';

const DAY = 86400000;
const CASE_CAP = 100;
const TXN_PER_CASE = 40;

const SUGGEST_SCHEMA = {
  type: 'object',
  properties: {
    title: { type: 'string', description: 'Short name of the tuning change' },
    change: { type: 'string', description: 'The exact change, e.g. "raise sum threshold from 8000 to 9000" or "exclude payroll category"' },
    expected_effect: { type: 'string', description: 'Expected effect on alert volume and on known-case coverage, in plain words' },
    insufficient_evidence: { type: 'boolean' },
    missing: { type: 'array', items: { type: 'string' } },
  },
};
const SUGGEST_PROMPT = `You tune transaction-monitoring rules. Given a rule and its backtest, propose exactly ONE variant (for example exclude a segment or raise a threshold).
State the exact change and its expected effect on alert volume and on known-case coverage. Use only the numbers in the input; never invent figures.
This is a suggestion for a human reviewer. If the numbers are too thin to suggest anything, set insufficient_evidence=true and say what is missing.`;

/** Known reported cases in the window and how many the rule would have hit. found=null when it cannot be computed. */
export async function knownCaseCoverage(ctx, def, sinceIso) {
  const { E, tenantId } = ctx;
  const cases = asList(await E.TmCase.filter({ tenant_id: tenantId, co_decision: 'report', co_decided_at: { $gte: sinceIso } }, '-co_decided_at', CASE_CAP));
  const total = cases.length;
  const why = unsupportedReason(def);
  if (why) return { total, found: null, note: why };
  if (!total) return { total, found: 0, note: 'No reported cases in this window.' };

  const alertIds = [...new Set(cases.flatMap((c) => c.alert_ids || []))];
  const alerts = alertIds.length ? asList(await E.TmAlert.filter({ tenant_id: tenantId, id: { $in: alertIds } }, undefined, 500)) : [];
  const alertById = new Map(alerts.map((a) => [a.id, a]));
  const clientIds = [...new Set(cases.flatMap((c) => [c.primary_client_id, ...(c.client_ids || [])]).filter(Boolean))];
  const widest = Math.max(30, ...def.aggregation.map((a) => Number(a.window.slice(0, -1)) * ({ m: 1 / 1440, h: 1 / 24, d: 1 }[a.window.slice(-1)])));
  const poolSince = new Date(new Date(sinceIso).getTime() - Math.min(widest, 365) * DAY).toISOString();
  const poolByClient = new Map();
  for (const id of clientIds.slice(0, 50)) {
    poolByClient.set(id, asList(await E.Transaction.filter({ tenant_id: tenantId, client_id: id, executed_at: { $gte: poolSince } }, '-executed_at', 1000)));
  }
  let found = 0;
  for (const c of cases) {
    const txnIds = new Set(c.alert_ids?.flatMap((id) => alertById.get(id)?.transaction_ids || []) || []);
    const pool = poolByClient.get(c.primary_client_id) || [];
    const hit = pool.filter((t) => txnIds.has(t.id)).slice(0, TXN_PER_CASE).some((t) => matches(def, t, pool));
    if (hit) found++;
  }
  return { total, found, note: '' };
}

async function suggest(ctx, rule, stats) {
  const { output, ai_run_id } = await runTmAgent(ctx.base44, {
    tenantId: ctx.tenantId, agent: 'TmRuleDraft', schema: SUGGEST_SCHEMA, systemPrompt: SUGGEST_PROMPT, sources: [],
    input: { rule: rule.definition, backtest: stats },
  });
  if (output.insufficient_evidence || !output.change) return { insufficient: true, missing: output.missing || [], ai_run_id };
  return { title: output.title || 'Tuning variant', change: output.change, expected_effect: output.expected_effect || '', ai_run_id };
}

export async function runRuleBacktest(ctx, rule, { window_from, window_to }) {
  if (rule.mode === 'retired') throw httpError(409, 'A retired rule cannot be backtested');
  if (rule.sync_status === 'drift') throw httpError(409, 'This rule changed in Didit. Resolve the drift before backtesting.');
  const def = validateDefinition(rule.definition);
  const from = new Date(window_from);
  const to = new Date(window_to);
  const now = Date.now();
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || from >= to) throw httpError(400, 'Choose a valid window: start before end');
  if (to.getTime() < now - 2 * DAY) throw httpError(400, 'Didit backtests look back from today. Choose a window that ends today.');
  const period = Math.min(365, Math.max(1, Math.ceil((now - from.getTime()) / DAY)));

  let stats;
  try {
    stats = await backtestRule(ctx.tenant, { conditions: def.conditions, aggregation: def.aggregation, evaluation_mode: def.evaluation_mode, scope: def.scope, period_days: period });
  } catch (e) {
    throw httpError(502, `Didit backtest failed: ${errText(e)}`);
  }
  const hits = Number(stats?.matched) || 0;
  const known = await knownCaseCoverage(ctx, def, from.toISOString());
  const record = await ctx.E.RuleBacktest.create({
    tenant_id: ctx.tenantId, rule_id: rule.id, rule_version: rule.version || 1,
    window_from: from.toISOString().slice(0, 10), window_to: to.toISOString().slice(0, 10),
    hits_txn: hits, hits_customers: Number(stats?.affected_entities) || 0,
    known_cases_total: known.total, ...(known.found == null ? {} : { known_cases_found: known.found }),
    est_alerts_month: Math.round((hits / period) * 30 * 10) / 10,
    raw: { didit: stats, period_days: period, known_note: known.note || undefined },
    run_by_user_id: ctx.auth.actorUserId,
  });
  await ctx.E.TmRule.update(rule.id, { backtest_id: record.id });
  await writeAudit(ctx.base44, ctx.auth, {
    tenantId: ctx.tenantId, eventType: 'tm_rule_backtest', before: { backtest_id: rule.backtest_id || null },
    after: { backtest_id: record.id, hits_txn: hits, hits_customers: record.hits_customers, known_cases_found: known.found, known_cases_total: known.total, period_days: period },
    notes: `Backtest of "${rule.name}" v${rule.version} over ${period} days: ${hits} hits.`,
  });

  let suggestion = null;
  try {
    suggestion = await suggest(ctx, rule, { period_days: period, evaluated: stats?.evaluated, hits_txn: hits, hits_customers: record.hits_customers, est_alerts_month: record.est_alerts_month, known_cases_found: known.found, known_cases_total: known.total });
  } catch (e) {
    suggestion = { error: 'The tuning suggestion could not be generated. Run the backtest again to retry.' };
  }
  await ctx.E.RuleBacktest.update(record.id, { raw: { ...record.raw, suggestion } });
  return { backtest_id: record.id, hits_txn: hits, hits_customers: record.hits_customers, est_alerts_month: record.est_alerts_month, known_cases_found: known.found, known_cases_total: known.total, suggestion };
}