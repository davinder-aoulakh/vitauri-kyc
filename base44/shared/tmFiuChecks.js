// Pre-approval checks for an FIU report + the evidence snapshot stored at approval. All queries are tenant-scoped.
import { asList, httpError } from './tmAuth.js';
import { missingFields, distinct } from './tmFiuMap.js';

const round = (n) => Math.round(n * 100) / 100;
const sumBy = (rows) => {
  const m = {};
  for (const r of rows) { const c = r.currency || '?'; m[c] = round((m[c] || 0) + (Number(r.amount) || 0)); }
  return m;
};
const sameTotals = (a, b) => [...new Set([...Object.keys(a), ...Object.keys(b)])].every((k) => Math.abs((a[k] || 0) - (b[k] || 0)) < 0.005);
const day = (iso) => String(iso || '').slice(0, 10);

export async function loadRefs(ctx, report) {
  const { E, tenantId } = ctx;
  const one = async (p) => asList(await p)[0] || null;
  const [fiu, client, tmCase] = await Promise.all([
    one(E.FiuProfile.filter({ tenant_id: tenantId, code: report.fiu_profile_code })),
    one(E.Client.filter({ tenant_id: tenantId, id: report.client_id })),
    one(E.TmCase.filter({ tenant_id: tenantId, id: report.tm_case_id })),
  ]);
  if (!client) throw httpError(404, 'Client not found');
  return { fiu, client, tmCase };
}

async function loadEvidence(ctx, report) {
  const { E, tenantId } = ctx;
  const alertIds = report.alert_ids || [];
  const alerts = alertIds.length ? asList(await E.TmAlert.filter({ tenant_id: tenantId, id: { $in: alertIds } }, undefined, 100)) : [];
  const txnIds = distinct(alerts.flatMap((a) => a.transaction_ids || [])).slice(0, 200);
  const txns = txnIds.length ? asList(await E.Transaction.filter({ tenant_id: tenantId, id: { $in: txnIds } }, undefined, 200)) : [];
  return { alerts, txnIds, txns };
}

async function coverageGaps(ctx, report, snapTxns) {
  const dates = snapTxns.map((t) => day(t.date)).filter(Boolean).sort();
  if (!dates.length) return [];
  const rows = asList(await ctx.E.CoverageDay.filter({
    tenant_id: ctx.tenantId, client_id: report.client_id, expected: true,
    state: { $in: ['missing', 'awaiting'] }, date: { $gte: dates[0], $lte: dates[dates.length - 1] },
  }, 'date', 200));
  return rows;
}

/** Returns { checks:[{key,label,ok,detail}], ok, past_due, data }. Never throws for a failed check. */
export async function runChecks(ctx, report, { latenessReason } = {}) {
  const { fiu, client, tmCase } = await loadRefs(ctx, report);
  const ev = await loadEvidence(ctx, report);
  const checks = [];
  const add = (key, label, ok, detail) => checks.push({ key, label, ok, detail });

  const missing = missingFields(fiu?.mandatory_fields, report.fields || [], client);
  add('mandatory', 'All mandatory fields are present', missing.length === 0, missing.length ? `Missing: ${missing.join(', ')}` : '');

  const snapTxns = report.snapshot?.transactions || [];
  const liveIds = new Set(ev.txns.map((t) => t.id));
  const snapIds = new Set(snapTxns.map((t) => t.id));
  const idsMatch = liveIds.size === snapIds.size && [...liveIds].every((id) => snapIds.has(id));
  const snapTotals = sumBy(snapTxns);
  const liveTotals = sumBy(ev.txns);
  const totalsOk = idsMatch && sameTotals(snapTotals, liveTotals);
  add('totals', 'Report transaction totals equal the sum of the linked transactions', totalsOk,
    totalsOk ? Object.entries(liveTotals).map(([c, v]) => `${v} ${c}`).join(', ') : `Report ${JSON.stringify(snapTotals)} vs ledger ${JSON.stringify(liveTotals)}. Refresh the draft.`);

  const due = report.clock?.due_at;
  const pastDue = !!due && Date.now() > new Date(due).getTime();
  const lateness = String(latenessReason || report.lateness_reason || '').trim();
  add('timeliness', pastDue ? 'Past the deadline: a lateness reason is recorded' : 'Within the reporting deadline', !pastDue || lateness.length >= 5,
    pastDue ? (lateness ? `Reason: ${lateness}` : `Deadline was ${due}. A lateness reason is required.`) : '');

  add('tipping_off', 'Tipping-off lock is on for the customer', !!client.tipping_off_lock,
    client.tipping_off_lock ? '' : 'The customer is not locked. Customer communications must be locked before approval.');

  const gaps = await coverageGaps(ctx, report, snapTxns);
  const disclosed = /coverage gap/i.test(report.narrative?.text || '');
  add('coverage', 'Data gaps are stated in the narrative', !gaps.length || disclosed,
    gaps.length ? `${gaps.length} day(s) without data in the period (${gaps[0].date} to ${gaps[gaps.length - 1].date}).${disclosed ? '' : ' Add a sentence starting "Coverage gap:" to the narrative.'}` : 'No coverage gaps in the period.');

  return { checks, ok: checks.every((c) => c.ok), past_due: pastDue, data: { fiu, client, tmCase, ...ev } };
}

/** Evidence snapshot stored at approval. */
export async function buildApprovalSnapshot(ctx, report, data) {
  const { E, tenantId } = ctx;
  const { alerts, txns, client } = data;
  const approved = asList(await E.ExpectedProfile.filter({ tenant_id: tenantId, client_id: client.id, status: 'approved' }, '-version', 1))[0];
  const ruleIds = distinct(alerts.flatMap((a) => a.rule_ids || []));
  const rules = ruleIds.length ? asList(await E.TmRule.filter({ tenant_id: tenantId, id: { $in: ruleIds } }, undefined, 200)) : [];
  const cpIds = distinct(txns.map((t) => t.counterparty_id));
  const cps = cpIds.length ? asList(await E.Counterparty.filter({ tenant_id: tenantId, id: { $in: cpIds } }, undefined, 100)) : [];
  const runIds = distinct([report.snapshot?.narrative_run_id, ...alerts.map((a) => a.ai_run_id)]);
  const runs = runIds.length ? asList(await E.AiAgentRun.filter({ tenant_id: tenantId, id: { $in: runIds } }, undefined, 50)) : [];
  return {
    profile_version: approved?.version ?? report.snapshot?.profile_version ?? null,
    rule_versions: Object.fromEntries(ruleIds.map((id) => [id, rules.find((r) => r.id === id)?.version ?? null])),
    fx_rates: Object.fromEntries(txns.filter((t) => t.fx?.rate).map((t) => [t.id, { rate: t.fx.rate, rate_date: t.fx.rate_date, reporting_currency: t.fx.reporting_currency }])),
    screening_ids: distinct(cps.flatMap((c) => c.screening_hit_ids || [])),
    model_versions: Object.fromEntries(runs.map((r) => [r.id, r.model_version || r.model_used || null])),
    approved_snapshot_at: new Date().toISOString(),
  };
}