// tmTxnDecision — what Vitauri does with a Didit transaction decision (status, risk score, rule runs).
// Used by the webhook (diditWebhook) AND at submission time (submitToDidit / createDiditTransaction), so an
// IN_REVIEW / AWAITING_USER / DECLINED answer in the POST response raises the alert at once instead of waiting
// for the webhook. Moved unchanged from diditWebhook, plus: DECLINED blocks the transaction in Vitauri.
import { normaliseTxnStatus } from './diditTm.js';
import { afterTransactionUpdate } from './diditTxnActions.js';
import { safeAlertRef } from './tmRefs.js';
import { computeDue } from './tmClock.js';
import { scheduleAutoTriage } from './tmAutoTriage.js';
import { safeRecompute } from './tmRisk.js';

// ── P11: Transaction Monitoring path (tm_core enabled) ───────────────────────
export const TM_ALERT_STATUSES = ['IN_REVIEW', 'DECLINED', 'AWAITING_USER'];
const TM_OPEN_STATUSES = ['new', 'triaged', 'in_review'];

export function extractRuleRuns(rec) {
  const list = rec?.rule_runs || rec?.rules_triggered || rec?.triggered_rules
    || rec?.decision?.rule_runs || rec?.decision?.rules_triggered || rec?.rules;
  if (!Array.isArray(list)) return [];
  return list.filter((r) => r && typeof r === 'object').map((r) => ({
    ...r,
    rule_id: r.rule_id || r.id || r.rule?.id || null,
    name: r.name || r.rule_name || r.rule?.name || null,
    score: r.score ?? r.risk_score ?? null,
  }));
}

function isoWeekKey(iso) {
  const d = new Date(iso);
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((t.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${t.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

const isCuracao = (v) => !!v && (String(v).trim().toUpperCase() === 'CW' || /cura[cç]ao/i.test(String(v)));
const uniq = (arr) => [...new Set(arr.filter(Boolean))];
const calcPriority = (score, dueAt) => {
  const hoursToDue = dueAt ? (new Date(dueAt).getTime() - Date.now()) / 3600000 : 72;
  return (score || 0) * (1 + Math.max(0, 72 - hoursToDue) / 72);
};


/**
 * Apply one Didit decision record to a Transaction. opts: { body, diditTransactionId, ourTransactionId, actorName, waitUntilFn }.
 * Idempotent: the alert is deduped per client + rule + ISO week; blocking only once.
 */
export async function applyTxnDecision(base44, tenant, txn, rec, opts = {}) {
  const E = base44.asServiceRole.entities;
  const tenantId = tenant.id;
  const body = opts.body || rec;
  const actorName = opts.actorName || 'Didit Webhook';
  const diditTransactionId = opts.diditTransactionId || rec?.uuid || txn.didit_transaction_id;
  const ourTransactionId = opts.ourTransactionId || txn.our_transaction_id;
  if (txn.tenant_id !== tenantId) return null;

  const prevStatus = txn.status;
  const status = normaliseTxnStatus(rec.status ?? body.status ?? txn.status ?? '');
  const riskScore = rec.risk_score ?? rec.decision?.risk_score ?? body.risk_score ?? body.decision?.risk_score ?? rec.score ?? body.score ?? txn.risk_score;
  const riskLevel = rec.risk_level ?? rec.decision?.risk_level ?? body.risk_level ?? body.decision?.risk_level ?? rec.severity ?? body.severity ?? txn.risk_level;
  let ruleRuns = extractRuleRuns(rec);
  if (ruleRuns.length === 0 && rec !== body) ruleRuns = extractRuleRuns(body);

  // DECLINED = blocked in Vitauri (the core banking system stops / holds the payment; Vitauri flags it)
  const block = status === 'DECLINED' && !txn.blocked
    ? { blocked: true, blocked_at: new Date().toISOString(), blocked_reason: `Declined by Didit${ruleRuns.find((r) => r.name)?.name ? `: ${ruleRuns.find((r) => r.name).name}` : ''}` }
    : {};
  const updatedTxn = { ...txn, ...block, status, risk_score: riskScore, risk_level: riskLevel, didit_rule_runs: ruleRuns, executed_at: txn.executed_at };
  await E.Transaction.update(txn.id, {
    status, risk_score: riskScore, risk_level: riskLevel, decision_raw: rec, didit_rule_runs: ruleRuns, ...block,
    ...(!txn.didit_transaction_id && (rec.uuid || diditTransactionId) ? { didit_transaction_id: rec.uuid || diditTransactionId } : {}),
  });

  try {
    await afterTransactionUpdate(base44, tenant, updatedTxn, prevStatus, status, rec);
  } catch (e) {
    console.warn('applyTxnDecision: afterTransactionUpdate failed', e?.message || e);
  }

  let tmAlert = null;
  if (TM_ALERT_STATUSES.includes(status)) {
    tmAlert = await upsertTmAlert(base44, { tenant_id: tenantId, transaction: updatedTxn, rule_runs: ruleRuns, actorName, waitUntilFn: opts.waitUntilFn });
    if (txn.client_id) {
      try {
        await safeRecompute(base44, { tenantId, tenant, clientId: txn.client_id, trigger: 'tm_alert', actor: { actorType: 'System', actorName } });
      } catch (e) {
        console.warn('applyTxnDecision: customer risk recompute failed', e?.message || e);
      }
    }
    const existingMon = tmAlert?.id ? await E.MonitoringAlert.filter({ tenant_id: tenantId, tm_alert_id: tmAlert.id }) : [];
    if (tmAlert?.id && !(existingMon?.length > 0)) {
      await E.MonitoringAlert.create({
        tenant_id: tenantId, client_id: txn.client_id, case_id: txn.case_id || null,
        entity_name: txn.subject_full_name || txn.client_id, entity_type: 'Client', alert_type: 'Transaction_Rule_Hit',
        source: 'Didit Transaction Monitoring', tm_alert_id: tmAlert.id,
        details: { transaction_id: txn.id, didit_transaction_id: diditTransactionId, status, risk_score: riskScore, risk_level: riskLevel, rules: ruleRuns.map((r) => ({ rule_id: r.rule_id, name: r.name, score: r.score })) },
      }).catch((e) => console.warn('applyTxnDecision: MonitoringAlert create failed', e?.message));
    }
  }

  if (block.blocked) {
    const client = (await E.Client.filter({ tenant_id: tenantId, id: txn.client_id }).catch(() => []))?.[0];
    if (client?.assigned_analyst_id) {
      await E.Notification.create({
        tenant_id: tenantId, user_id: client.assigned_analyst_id, type: 'monitoring_alert',
        title: `Transaction blocked: declined by Didit`, body: `${client.full_name || 'Client'} — ${txn.amount ?? ''} ${txn.currency || ''} ${txn.direction || ''}. ${block.blocked_reason}.`,
        link_client_id: client.id, is_read: false, dedupe_key: `${client.assigned_analyst_id}:${txn.id}:blocked`,
      }).catch(() => {});
    }
    await E.AuditEvent.create({
      tenant_id: tenantId, case_id: txn.case_id || null, client_id: txn.client_id, actor_type: 'System', actor_name: actorName,
      event_type: 'tm_transaction_blocked', before_state: { status: prevStatus, blocked: false }, after_state: { status, blocked: true, reason: block.blocked_reason },
      notes: `Transaction ${txn.id} blocked in Vitauri: ${block.blocked_reason}.`,
    }).catch(() => {});
  }

  await E.AuditEvent.create({
    tenant_id: tenantId, case_id: txn.case_id || null, client_id: txn.client_id, actor_type: 'System', actor_name: actorName,
    event_type: 'didit_transaction_webhook',
    notes: `Didit transaction ${actorName === 'Didit Webhook' ? 'webhook' : 'decision'}: ${status}. Transaction ${diditTransactionId || ourTransactionId}. Risk score: ${riskScore ?? 'n/a'}.`,
  }).catch(() => {});
  return { status, tmAlert, blocked: !!block.blocked };
}

// Internal: create or extend the open TmAlert for client + first rule + ISO week.
export async function upsertTmAlert(base44, { tenant_id, transaction, rule_runs, actorName = 'Didit Webhook', waitUntilFn }) {
  const E = base44.asServiceRole.entities;
  const nowIso = new Date().toISOString();
  const executedAt = transaction.executed_at || nowIso;
  const firstRuleId = rule_runs.find((r) => r.rule_id)?.rule_id || null;
  const dedupeKey = `${transaction.client_id}:${firstRuleId || 'score'}:${isoWeekKey(executedAt)}`;
  const score = transaction.risk_score ?? 0;
  const ruleIds = uniq(rule_runs.map((r) => r.rule_id));

  const open = await E.TmAlert.filter({ tenant_id, dedupe_key: dedupeKey, status: { $in: TM_OPEN_STATUSES } });
  const existing = open?.[0];

  if (existing) {
    const patch = {
      transaction_ids: uniq([...(existing.transaction_ids || []), transaction.id]),
      rule_ids: uniq([...(existing.rule_ids || []), ...ruleIds]),
      didit_transaction_ids: uniq([...(existing.didit_transaction_ids || []), transaction.didit_transaction_id]),
      score: Math.max(existing.score || 0, score),
    };
    patch.priority = calcPriority(patch.score, existing.due_at);
    await E.TmAlert.update(existing.id, patch);
    await E.AuditEvent.create({
      tenant_id, client_id: transaction.client_id, actor_type: 'System', actor_name: actorName,
      event_type: 'tm_alert_updated',
      before_state: { transaction_ids: existing.transaction_ids || [], rule_ids: existing.rule_ids || [], score: existing.score ?? null },
      after_state: { transaction_ids: patch.transaction_ids, rule_ids: patch.rule_ids, score: patch.score },
      notes: `Transaction ${transaction.id} added to TM alert ${existing.id} (${dedupeKey}).`,
    }).catch(() => {});
    return { ...existing, ...patch };
  }

  // Rule → scenario mapping for title / indicator type.
  let tmRule = null;
  let scenario = null;
  if (firstRuleId) {
    tmRule = (await E.TmRule.filter({ tenant_id, didit_rule_id: firstRuleId }))?.[0] || null;
    if (tmRule?.scenario_id) scenario = (await E.TmScenario.filter({ tenant_id, id: tmRule.scenario_id }))?.[0] || null;
  }
  const indicatorType = scenario?.indicator_type || 'subjective';
  const title = rule_runs.find((r) => r.name)?.name || tmRule?.name || 'Transaction monitoring alert';

  // Client + FIU profile (CW when resident/registered in Curaçao, else NL, fallback CW).
  const client = (await E.Client.filter({ tenant_id, id: transaction.client_id }))?.[0] || null;
  const wanted = isCuracao(client?.country_of_residence) || isCuracao(client?.registered_country) ? 'CW' : 'NL';
  const profiles = await E.FiuProfile.filter({ tenant_id });
  const profile = profiles?.find((p) => p.code === wanted) || profiles?.find((p) => p.code === 'CW') || null;
  const { due_at } = computeDue(profile, { indicator_type: indicatorType, executed_at: executedAt, discovered_at: nowIso });

  const created = await E.TmAlert.create({
    ref: await safeAlertRef(E, tenant_id),
    tenant_id,
    client_id: transaction.client_id,
    transaction_ids: [transaction.id],
    rule_ids: ruleIds,
    scenario_id: scenario?.id || undefined,
    didit_transaction_ids: uniq([transaction.didit_transaction_id]),
    title,
    score,
    priority: calcPriority(score, due_at),
    status: 'new',
    indicator_type: indicatorType,
    ...(transaction.intended_at ? { intended_at: transaction.intended_at } : {}),
    executed_at: executedAt,
    received_at: nowIso,
    discovered_at: nowIso,
    due_at: due_at || undefined,
    dedupe_key: dedupeKey,
    source: 'didit_rule',
  });

  if (client?.assigned_analyst_id) {
    await E.Notification.create({
      tenant_id,
      user_id: client.assigned_analyst_id,
      type: 'monitoring_alert',
      title: `New transaction alert: ${title}`,
      body: `Client ${client.full_name || client.id} — risk score ${score}.`,
      link_client_id: client.id,
      is_read: false,
    }).catch((e) => console.warn('diditWebhook: notification failed', e?.message));
  }

  await E.AuditEvent.create({
    tenant_id, client_id: transaction.client_id, actor_type: 'System', actor_name: actorName,
    event_type: 'tm_alert_created',
    before_state: {},
    after_state: { tm_alert_id: created.id, dedupe_key: dedupeKey, score, indicator_type: indicatorType, due_at: due_at || null },
    notes: `TM alert created from transaction ${transaction.id}: ${title}.`,
  }).catch(() => {});

  await scheduleAutoTriage(base44, { tenantId: tenant_id, alertId: created.id, waitUntilFn });
  return created;
}