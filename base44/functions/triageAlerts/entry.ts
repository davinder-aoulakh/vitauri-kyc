// triageAlerts — AI triage PROPOSALS for TM alerts (agent 'TmTriage'). Never closes or escalates an alert:
// the only status change is new -> triaged. Auth: signed-in user with tmViewAlerts; tenant from the user. Requires tm_core.
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.52';
import { isTmEnabled } from '../../shared/tmGuards.js';
import { authenticate, errorResponse, httpError, loadTenant, asList, mapLimit } from '../../shared/tmAuth.js';
import { runTmAgent } from '../../shared/tmAi.js';
import { writeAudit } from '../../shared/tmAudit.js';
import { counterpartyRelations } from '../../shared/tmCounterparty.js';

const VIEW_ROLES = ['Analyst', 'QC Reviewer', 'Compliance Officer', 'Manager', 'Director', 'Compliance Admin']; // tmViewAlerts
const CLOSED = ['closed_false_positive', 'closed_no_action', 'reported'];
const DAY_MS = 86400000;
const MAX_ALERTS = 25;
const TXN_CAP = 40;

const SCHEMA = {
  type: 'object',
  properties: {
    proposal: { type: 'string', enum: ['escalate', 'close', 'request_info', 'insufficient_evidence'] },
    reasons: {
      type: 'array',
      items: {
        type: 'object',
        properties: { text: { type: 'string' }, source_refs: { type: 'array', items: { type: 'string' } } },
      },
    },
    insufficient_evidence: { type: 'boolean' },
    missing: { type: 'array', items: { type: 'string' } },
  },
};

const SYSTEM_PROMPT = `You are a transaction monitoring triage assistant. Propose what an analyst should do with ONE alert: escalate, close, request_info or insufficient_evidence.
Rules: only state facts supported by the input; give short reasons and cite source_refs for each; never give percentages or confidence scores; never speculate about intent; do not recommend filing a report. You only PROPOSE: a human decides. If evidence is thin, use insufficient_evidence and list what is missing.`;

const FRESH_MS = 15 * 60000;

async function triageOne(base44, auth, tenantId, alertId) {
  const E = base44.asServiceRole.entities;
  const alert = asList(await E.TmAlert.filter({ tenant_id: tenantId, id: alertId }))[0];
  if (!alert) throw httpError(404, 'Alert not found');
  if (CLOSED.includes(alert.status)) throw httpError(409, `Alert is ${alert.status}`);
  // Service-role (auto-triage) calls only touch alerts that were just created and are still untouched.
  if (auth.mode === 'service' && (alert.status !== 'new' || alert.ai_proposal || Date.now() - new Date(alert.created_date).getTime() > FRESH_MS)) {
    throw httpError(409, 'Auto-triage only applies to new, untriaged alerts');
  }

  const since = new Date(Date.now() - 90 * DAY_MS).toISOString();
  const txnIds = (alert.transaction_ids || []).slice(0, TXN_CAP);
  const [txns, profile, prior] = await Promise.all([
    txnIds.length ? E.Transaction.filter({ tenant_id: tenantId, id: { $in: txnIds } }, undefined, TXN_CAP).then(asList) : [],
    E.ExpectedProfile.filter({ tenant_id: tenantId, client_id: alert.client_id, status: 'approved' }, '-version', 1).then((r) => asList(r)[0] || null),
    E.TmAlert.filter({ tenant_id: tenantId, client_id: alert.client_id, created_date: { $gte: since } }, '-created_date', 50).then(asList),
  ]);
  const cpIds = [...new Set(txns.map((t) => t.counterparty_id).filter(Boolean))].slice(0, 50);
  const cps = cpIds.length ? asList(await E.Counterparty.filter({ tenant_id: tenantId, id: { $in: cpIds } }, undefined, 50)) : [];
  const priorOthers = prior.filter((a) => a.id !== alert.id);
  // Flows with the client's own UBO / director / related company read very differently from third-party flows.
  const relations = await counterpartyRelations(E, tenantId, [alert.client_id], cps).catch(() => new Map());

  const gaps: string[] = [];
  if (!profile) gaps.push('No approved expected profile.');
  if (!txns.length) gaps.push('Alert has no linked transactions.');

  const sources = [
    `alert:${alert.id}`, ...txns.map((t) => `txn:${t.id}`), ...priorOthers.map((a) => `alert:${a.id}`),
    ...cps.map((c) => `cp:${c.id}`), ...(profile ? [`profile:${profile.id}`] : []),
  ];
  const { output, ai_run_id } = await runTmAgent(base44, {
    tenantId, agent: 'TmTriage', alertId: alert.id, input: {
      alert: { ref: `alert:${alert.id}`, title: alert.title, score: alert.score, source: alert.source, indicator_type: alert.indicator_type, rule_signals: alert.ai_reasons || [] },
      profile: profile ? { ref: `profile:${profile.id}`, version: profile.version, currency: profile.currency, inbound_max_month: profile.inbound_max_month, inbound_max_count_month: profile.inbound_max_count_month, outbound_foreign_max_month: profile.outbound_foreign_max_month, cash_max_month: profile.cash_max_month, allowed_countries: profile.allowed_countries } : null,
      transactions: txns.map((t) => ({ ref: `txn:${t.id}`, date: t.executed_at, direction: t.direction, amount: t.amount, currency: t.currency, country: t.counterparty_country, category: t.category, counterparty: t.counterparty_name, rule_runs: t.didit_rule_runs })),
      prior_alerts_90d: priorOthers.map((a) => ({ ref: `alert:${a.id}`, title: a.title, status: a.status, created: a.created_date })),
      counterparties: cps.map((c) => ({ ref: `cp:${c.id}`, name: c.display_name, country: c.country, screening_status: c.screening_status, ...(relations.get(c.id) ? { related_party: relations.get(c.id).text } : {}) })),
      data_gaps: gaps,
    },
    sources, schema: SCHEMA, systemPrompt: SYSTEM_PROMPT,
  });

  const reasons = Array.isArray(output.reasons) ? output.reasons.filter((r) => r?.text) : [];
  const insufficient = !!output.insufficient_evidence || reasons.length === 0;
  const proposal = insufficient ? 'insufficient_evidence' : (output.proposal || 'request_info');
  const missing = [...new Set([...gaps, ...(output.missing || [])])];

  const patch: Record<string, unknown> = {
    ai_proposal: proposal, ai_reasons: reasons.map((r) => r.text), ai_reason_refs: reasons.map((r) => ({ text: r.text, source_refs: r.source_refs })),
    ai_run_id, ai_insufficient_evidence: insufficient, ai_missing: missing,
  };
  if (alert.status === 'new') patch.status = 'triaged'; // the AI never sets closed / escalated
  await E.TmAlert.update(alert.id, patch);
  await writeAudit(base44, { ...auth, actorType: 'AI_Agent', actorName: 'TmTriage' }, {
    tenantId, clientId: alert.client_id, eventType: 'tm_alert_triaged',
    before: { status: alert.status, ai_proposal: alert.ai_proposal || null },
    after: { status: patch.status || alert.status, ai_proposal: proposal, ai_run_id },
    notes: `AI triage proposal for alert ${alert.id}: ${proposal} (requested by ${auth.actorName}). A human decides.`,
  });
  return { alert_id: alert.id, proposal, status: patch.status || alert.status };
}

export default async function (req) {
  try {
    const base44 = createClientFromRequest(req);
    const body = await req.json();
    // Service-role call (auto-triage): no user and no API key, explicit tenant_id. Allowed only when the tenant opted in.
    const hasKey = !!(req.headers.get('x-api-key') || body.api_key);
    const user = hasKey ? null : await base44.auth.me().catch(() => null);
    const serviceCall = !user && !hasKey && !!body.tenant_id;
    const auth = serviceCall
      ? { mode: 'service', tenantId: String(body.tenant_id), actorType: 'System', actorName: 'Auto-triage', actorUserId: undefined }
      : await authenticate(base44, req, body, { roles: VIEW_ROLES, allowApiKey: false });
    const tenantId = auth.tenantId;
    const ids = [...new Set(Array.isArray(body.alert_ids) ? body.alert_ids : [])].slice(0, serviceCall ? 1 : MAX_ALERTS);
    if (!ids.length) throw httpError(400, 'alert_ids is required');
    const tenant = await loadTenant(base44, tenantId);
    if (!isTmEnabled(tenant, 'tm_core')) throw httpError(403, 'Feature tm_core is not enabled');
    if (serviceCall) {
      let s = tenant.tm_settings;
      if (typeof s === 'string') { try { s = JSON.parse(s); } catch { s = null; } }
      if (s?.auto_triage_new_alerts !== true) throw httpError(403, 'Auto-triage is not enabled for this tenant');
    }

    const res = await mapLimit(ids, 3, (id) => triageOne(base44, auth, tenantId, id));
    const results = res.map((r, i) => (r.ok ? r.value : { alert_id: ids[i], error: String(r.error?.message || r.error).slice(0, 200) }));
    return Response.json({ ok: true, triaged: results.filter((r) => !r.error).length, results });
  } catch (error) {
    console.error('triageAlerts error:', error?.message);
    return errorResponse(error);
  }
}