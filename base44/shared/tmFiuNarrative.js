// TmNarrative agent: evidence-cited narrative for an FIU report (uses the shared TM agent runner).
import { runTmAgent } from './tmAi.js';
import { distinct } from './tmFiuMap.js';

const SCHEMA = {
  type: 'object',
  properties: {
    text: { type: 'string' },
    sentences: { type: 'array', items: { type: 'object', properties: { text: { type: 'string' }, source_refs: { type: 'array', items: { type: 'string' } } }, required: ['text', 'source_refs'] } },
    profile_comparison: { type: 'string' },
    data_gaps_statement: { type: 'string' },
    insufficient_evidence: { type: 'boolean' },
    missing: { type: 'array', items: { type: 'string' } },
  },
  required: ['text', 'sentences', 'profile_comparison', 'data_gaps_statement', 'insufficient_evidence', 'missing'],
};

const PROMPT = `You write the narrative of an unusual-transaction report for a financial intelligence unit.
Rules: state only facts supported by the input; every sentence must cite source_refs; compare the observed activity with the approved expected profile (name its version) in profile_comparison, or say plainly that no approved profile exists; list every data gap in data_gaps_statement; never speculate about intent and never conclude guilt.`;

/** Returns { text, citations, ai_run_id, gaps, error }. text is empty when the narrative could not be produced with citations. */
export async function writeNarrative(ctx, { tmCase, alerts, txns, approved, client, cur }) {
  const gaps = [];
  if (!approved) gaps.push('No approved expected profile.');
  if (!txns.length) gaps.push('No transactions are linked to the alerts.');
  const topTxns = txns.slice(0, 100);
  const evidence = (tmCase.evidence || []).map((e) => ({ ref: `evidence:${e.id}`, kind: e.kind, text: e.text, accepted: e.accepted !== false }));
  const sources = [
    ...evidence.map((e) => e.ref), ...topTxns.map((t) => `txn:${t.id}`), ...alerts.map((a) => `alert:${a.id}`),
    ...(approved ? [`profile:${approved.id}`] : []),
  ];
  const input = {
    reporting_currency: cur,
    client: { name: client.full_name, type: client.client_type, country: client.country_of_residence || client.registered_country },
    evidence,
    alerts: alerts.map((a) => ({ ref: `alert:${a.id}`, title: a.title, indicator_type: a.indicator_type, reasons: a.ai_reasons })),
    transactions: topTxns.map((t) => ({ ref: `txn:${t.id}`, date: String(t.executed_at || '').slice(0, 10), amount: t.amount, currency: t.currency, direction: t.direction, counterparty: t.counterparty_name, country: t.counterparty_country, lifecycle: t.lifecycle })),
    approved_profile: approved ? { ref: `profile:${approved.id}`, version: approved.version, currency: approved.currency, inbound_max_month: approved.inbound_max_month, inbound_max_count_month: approved.inbound_max_count_month, outbound_foreign_max_month: approved.outbound_foreign_max_month, cash_max_month: approved.cash_max_month, allowed_countries: approved.allowed_countries } : null,
    known_data_gaps: gaps,
    documents: topTxns.filter((t) => t.description_raw).map((t) => `txn:${t.id}: ${t.description_raw}`),
  };
  try {
    const { output, ai_run_id } = await runTmAgent(ctx.base44, {
      tenantId: ctx.tenantId, agent: 'TmNarrative', tmCaseId: tmCase.id, alertId: alerts[0]?.id, input, sources, schema: SCHEMA, systemPrompt: PROMPT,
    });
    const sentences = output.sentences || [];
    if (!sentences.length) return { text: '', citations: [], ai_run_id, gaps, error: 'The narrative had no cited sentences.' };
    const parts = [
      sentences.map((x) => x.text).join(' '),
      output.profile_comparison ? `Comparison with the approved expected profile${approved ? ` (version ${approved.version})` : ''}: ${output.profile_comparison}` : '',
      `Data gaps: ${[output.data_gaps_statement, ...gaps].filter(Boolean).join(' ') || 'none identified.'}`,
    ];
    return { text: parts.filter(Boolean).join('\n\n'), citations: distinct(sentences.flatMap((x) => x.source_refs)), ai_run_id, gaps };
  } catch (e) {
    return { text: '', citations: [], gaps, error: String(e?.message || e).slice(0, 200) };
  }
}