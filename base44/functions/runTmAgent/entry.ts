// runTmAgent — evidence-grounded TM agent invocation. Currently serves agent 'TmEvidence':
// 90-day summary of one client's transactions, alerts and expected profile, with sources and explicit data gaps.
// Auth: signed-in user with createRunCase; tenant from the user. Requires tm_core.
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.52';
import { isTmEnabled } from '../../shared/tmGuards.js';
import { authenticate, errorResponse, httpError, loadTenant, asList } from '../../shared/tmAuth.js';
import { fetchAll } from '../../shared/tmCoverage.js';
import { runTmAgent } from '../../shared/tmAi.js';
import { countableTxns, amountInReporting } from '../../shared/tmActuals.js';

const CREATE_RUN_CASE = ['Analyst', 'QC Reviewer', 'Compliance Officer', 'Manager', 'Director', 'Compliance Admin', 'Tenant Admin'];
const DAY_MS = 86400000;
const TXN_CAP = 100;

const SCHEMA = {
  type: 'object',
  properties: {
    summary: { type: 'string', description: 'Plain-language summary of the client\'s activity versus the expected profile over the last 90 days' },
    findings: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          text: { type: 'string' },
          kind: { type: 'string', enum: ['risk', 'ok', 'unclear', 'gap'] },
          source_refs: { type: 'array', items: { type: 'string' } },
        },
      },
    },
    insufficient_evidence: { type: 'boolean' },
    missing: { type: 'array', items: { type: 'string' } },
  },
};

const SYSTEM_PROMPT = `You are a transaction monitoring analyst assistant. Summarise the client's last 90 days of activity against the approved expected profile.
Rules: only state facts supported by the input; cite source_refs for each finding; explicitly list every data gap (see data_gaps) in "missing" and mention material gaps in the summary; never speculate about intent; do not recommend filing a report.`;

export default async function (req) {
  try {
    const base44 = createClientFromRequest(req);
    const body = await req.json();
    const auth = await authenticate(base44, req, body, { roles: CREATE_RUN_CASE, allowApiKey: false });
    const tenantId = auth.tenantId;
    const agent = body.agent || 'TmEvidence';
    if (agent !== 'TmEvidence') throw httpError(400, `Unsupported agent ${agent}`);
    if (!body.client_id) throw httpError(400, 'client_id is required');
    const E = base44.asServiceRole.entities;
    const tenant = await loadTenant(base44, tenantId);
    if (!isTmEnabled(tenant, 'tm_core')) throw httpError(403, 'Feature tm_core is not enabled');
    const client = asList(await E.Client.filter({ tenant_id: tenantId, id: body.client_id }))[0];
    if (!client) throw httpError(404, 'Client not found');
    const cur = tenant.tm_reporting_currency || 'USD';
    const since = new Date(Date.now() - 90 * DAY_MS);

    const [txnsAll, alerts, profile, coverage, accounts] = await Promise.all([
      fetchAll((cursor) => E.Transaction.filter({ tenant_id: tenantId, client_id: client.id, executed_at: { $gte: since.toISOString() } }, { limit: 1000, cursor }), 10),
      E.TmAlert.filter({ tenant_id: tenantId, client_id: client.id, created_date: { $gte: since.toISOString() } }, '-created_date', 50).then(asList),
      E.ExpectedProfile.filter({ tenant_id: tenantId, client_id: client.id, status: 'approved' }, '-version', 1).then((r) => asList(r)[0] || null),
      E.CoverageDay.filter({ tenant_id: tenantId, client_id: client.id, date: { $gte: since.toISOString().slice(0, 10) } }, undefined, 1000).then(asList),
      E.BankAccount.filter({ tenant_id: tenantId, client_id: client.id, status: 'active' }, undefined, 100).then(asList),
    ]);

    const txns = countableTxns(txnsAll);
    const byMonth: Record<string, { inbound: number; outbound: number; count: number }> = {};
    let unconverted = 0;
    for (const t of txns) {
      const a = amountInReporting(t, cur);
      if (a == null) { unconverted++; continue; }
      const k = String(t.executed_at || '').slice(0, 7);
      byMonth[k] = byMonth[k] || { inbound: 0, outbound: 0, count: 0 };
      byMonth[k][t.direction === 'inbound' ? 'inbound' : 'outbound'] += Math.round(a);
      byMonth[k].count++;
    }
    const top = [...txns].sort((a, b) => (amountInReporting(b, cur) || 0) - (amountInReporting(a, cur) || 0)).slice(0, TXN_CAP);

    // Deterministic data gaps (always reported, independent of the model).
    const gaps: string[] = [];
    if (!profile) gaps.push('No approved expected profile.');
    if (!txnsAll.length) gaps.push('No transactions in the last 90 days.');
    if (!accounts.length) gaps.push('No active bank accounts on file.');
    const coveredDays = new Set(coverage.filter((c) => ['received', 'processed', 'reviewed'].includes(c.state)).map((c) => c.date)).size;
    if (accounts.length && coveredDays < 90) gaps.push(`Data coverage: ${coveredDays} of 90 days received.`);
    if (unconverted) gaps.push(`${unconverted} transaction(s) could not be converted to ${cur} and are excluded from totals.`);
    if (txns.length > TXN_CAP) gaps.push(`Only the ${TXN_CAP} largest of ${txns.length} transactions are citable.`);

    const sources = [
      ...top.map((t) => `txn:${t.id}`), ...alerts.map((a) => `alert:${a.id}`),
      ...(profile ? [`profile:${profile.id}`] : []), 'monthly_totals',
    ];
    const { output, dropped_claims, ai_run_id } = await runTmAgent(base44, {
      tenantId, agent: 'TmEvidence', input: {
        reporting_currency: cur, client: { name: client.full_name, type: client.client_type, risk_classification: client.risk_classification, country_of_residence: client.country_of_residence },
        profile: profile ? { id: `profile:${profile.id}`, version: profile.version, currency: profile.currency, inbound_max_month: profile.inbound_max_month, inbound_max_count_month: profile.inbound_max_count_month, outbound_foreign_max_month: profile.outbound_foreign_max_month, cash_max_month: profile.cash_max_month, allowed_countries: profile.allowed_countries } : null,
        monthly_totals: { ref: 'monthly_totals', by_month: byMonth },
        alerts: alerts.map((a) => ({ ref: `alert:${a.id}`, title: a.title, status: a.status, source: a.source, reasons: a.ai_reasons })),
        largest_transactions: top.map((t) => ({ ref: `txn:${t.id}`, date: t.executed_at, direction: t.direction, amount_reporting: amountInReporting(t, cur), country: t.counterparty_country, category: t.category, counterparty: t.counterparty_name })),
        data_gaps: gaps,
      },
      sources, schema: SCHEMA, systemPrompt: SYSTEM_PROMPT,
    });

    const missing = [...new Set([...gaps, ...(output.missing || [])])];
    return Response.json({
      ok: true, summary: output.summary || '', findings: output.findings || [], missing,
      insufficient_evidence: !!output.insufficient_evidence, dropped_claims, ai_run_id,
      sources: [...new Set((output.findings || []).flatMap((f) => f.source_refs || []))],
    });
  } catch (error) {
    console.error('runTmAgent error:', error?.message);
    return errorResponse(error);
  }
}