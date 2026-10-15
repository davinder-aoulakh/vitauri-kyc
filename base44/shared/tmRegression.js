// Shared engine for the TM regression harness (Vitauri Ops only, Demo tenants only).
// Every query is filtered by the Demo tenant id; all records created for a replay are deleted afterwards.
import { computeDiditSignature } from './diditWebhookVerify.js';
import { asList, httpError, loadTenant, mapLimit } from './tmAuth.js';

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function requireOpsDemo(base44, tenantId) {
  const user = await base44.auth.me().catch(() => null);
  if (!user) throw httpError(401, 'Unauthorized');
  const role = user.app_role || user.data?.app_role;
  if (role !== 'Vitauri Ops') throw httpError(403, 'Vitauri Ops only');
  if (!tenantId || typeof tenantId !== 'string') throw httpError(400, 'tenant_id is required');
  const tenant = await loadTenant(base44, tenantId);
  if (tenant.status !== 'Demo') throw httpError(403, 'Regression runs are only allowed on Demo tenants');
  return { user, tenant, actorName: user.full_name || user.email };
}

export function parseFlags(tenant) {
  try {
    const raw = tenant?.features_enabled;
    if (!raw) return {};
    return typeof raw === 'string' ? JSON.parse(raw) : raw;
  } catch { return {}; }
}

export async function audit(E, tenantId, actorName, eventType, before, after, notes, clientId) {
  await E.AuditEvent.create({
    tenant_id: tenantId, client_id: clientId || undefined, actor_type: 'User', actor_name: actorName,
    event_type: eventType, before_state: before || {}, after_state: after || {}, notes,
  }).catch((e) => console.warn('tmRegression: audit failed', e?.message));
}

export async function setTmCore(E, tenant, on, actorName, runId) {
  const flags = parseFlags(tenant);
  const before = flags.tm_core === true;
  const next = { ...flags, tm_core: on };
  await E.Tenant.update(tenant.id, { features_enabled: JSON.stringify(next) });
  await audit(E, tenant.id, actorName, 'feature_flag_changed', { feature: 'tm_core', enabled: before }, { feature: 'tm_core', enabled: on },
    `Regression run ${runId}: tm_core turned ${on ? 'ON' : 'OFF'} for ${tenant.name}.`);
  return { ...tenant, features_enabled: JSON.stringify(next) };
}

function fill(payload, ctx) {
  const text = JSON.stringify(payload).replace(/\{\{(\w+)\}\}/g, (_, k) => String(ctx[k] ?? ''));
  return JSON.parse(text);
}

async function setupGroup(E, tenantId, fixtures) {
  const sfx = Math.random().toString(36).slice(2, 8);
  const first = fixtures[0];
  const literalSession = first.payload?.session_id && !String(first.payload.session_id).includes('{{') ? first.payload.session_id : null;
  const ctx = { tenant_id: tenantId, item_id: `item-${sfx}`, session_id: literalSession || `reg-sess-${sfx}`, our_transaction_id: `reg-txn-${sfx}`, didit_transaction_id: `reg-dtx-${sfx}` };
  const client = await E.Client.create({ tenant_id: tenantId, client_type: 'NP', full_name: `Regression Test ${sfx}`, first_names: 'Regression', last_name: `Test ${sfx}`, status: 'Prospect' });
  ctx.client_id = client.id;
  const kase = await E.KycCase.create({ tenant_id: tenantId, client_id: client.id, case_type: 'Onboarding', status: 'In_Progress', step_2_status: 'not_started' });
  ctx.case_id = kase.id;
  const outreach = await E.OutreachRequest.create({
    tenant_id: tenantId, client_id: client.id, case_id: kase.id, status: 'Sent', delivery_channel: 'Portal',
    items: [{ item_id: ctx.item_id, item_type: 'data_point', label: 'Identity verification', status: 'Requested', idv_status: 'Pending', didit_session_id: ctx.session_id, didit_session_status: 'Not Started' }],
  });
  ctx.outreach_id = outreach.id;
  if (fixtures.some((f) => f.kind === 'transaction')) {
    const txn = await E.Transaction.create({
      tenant_id: tenantId, client_id: client.id, our_transaction_id: ctx.our_transaction_id, didit_transaction_id: ctx.didit_transaction_id,
      direction: 'outbound', amount: 100, currency: 'USD', currency_kind: 'fiat', transaction_category: 'finance', status: 'PENDING',
      subject_full_name: `Regression Test ${sfx}`, executed_at: new Date().toISOString(),
    });
    ctx.transaction_id = txn.id;
  }
  return ctx;
}

async function cleanupGroup(E, tenantId, ctx) {
  const q = { tenant_id: tenantId, client_id: ctx.client_id };
  for (const name of ['TmAlert', 'MonitoringAlert', 'Transaction', 'OutreachRequest', 'KycCase', 'CustomerRiskScore', 'Notification']) {
    await E[name].deleteMany(q).catch((e) => console.warn(`tmRegression: cleanup ${name}`, e?.message));
  }
  await E.Client.delete(ctx.client_id).catch(() => {});
}

export async function snapshot(E, tenantId, ctx) {
  const [outreach] = asList(await E.OutreachRequest.filter({ tenant_id: tenantId, id: ctx.outreach_id }));
  const [kase] = asList(await E.KycCase.filter({ tenant_id: tenantId, id: ctx.case_id }));
  const [txn] = ctx.transaction_id ? asList(await E.Transaction.filter({ tenant_id: tenantId, id: ctx.transaction_id })) : [];
  const mon = asList(await E.MonitoringAlert.filter({ tenant_id: tenantId, client_id: ctx.client_id }));
  const tmAlerts = asList(await E.TmAlert.filter({ tenant_id: tenantId, client_id: ctx.client_id }));
  const item = (outreach?.items || []).find((i) => i.item_id === ctx.item_id);
  const txnAudit = ctx.transaction_id
    ? asList(await E.AuditEvent.filter({ tenant_id: tenantId, client_id: ctx.client_id, event_type: 'didit_transaction_webhook' }))
    : [];
  const ruleHits = mon.filter((a) => a.alert_type === 'Transaction_Rule_Hit');
  const riskRows = asList(await E.CustomerRiskScore.filter({ tenant_id: tenantId, client_id: ctx.client_id }));
  const riskAudit = riskRows.length ? [] : asList(await E.AuditEvent.filter({ tenant_id: tenantId, client_id: ctx.client_id, event_type: 'customer_risk_recomputed' }));
  return {
    tm_alert_ids: tmAlerts.map((a) => a.id),
    rule_hit_linked_to_tm_alert: ruleHits.length > 0 && ruleHits.every((a) => tmAlerts.some((t) => t.id === a.tm_alert_id)),
    txn_webhook_audit_recorded: txnAudit.length >= 1,
    risk_recompute_evidence: riskRows.length > 0 || riskAudit.length > 0,
    outreach_item_status: item?.status ?? null,
    outreach_idv_status: item?.idv_status ?? null,
    outreach_session_status: item?.didit_session_status ?? null,
    case_step_2_status: kase?.step_2_status ?? null,
    transaction_status: txn?.status ?? null,
    monitoring_alert_count: mon.length,
    monitoring_alert_types: mon.map((a) => a.alert_type).sort(),
    tm_alert_count: tmAlerts.length,
  };
}

export function compare(expected, actual) {
  const diffs = [];
  for (const k of Object.keys(expected || {})) {
    if (JSON.stringify(expected[k]) !== JSON.stringify(actual?.[k])) diffs.push({ field: k, expected: expected[k], actual: actual?.[k] ?? null });
  }
  return diffs;
}

async function postSigned(origin, tenant, body) {
  const raw = JSON.stringify(body);
  const sig = await computeDiditSignature(raw, tenant.didit_webhook_secret);
  const res = await fetch(`${origin}/functions/diditWebhook`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-signature-v2': sig, 'x-timestamp': String(Math.floor(Date.now() / 1000)) },
    body: raw,
    signal: AbortSignal.timeout(20000),
  });
  return res.status;
}

/**
 * Replays fixtures against the tenant in its CURRENT flag state through the real diditWebhook.
 * Returns { [fixture.id]: { snapshot, http_status, error } }. Test records are removed afterwards.
 */
export async function replayFixtures(base44, { tenant, fixtures, origin, actorName, tag }) {
  const E = base44.asServiceRole.entities;
  if (!tenant.didit_webhook_secret) throw httpError(409, 'This Demo tenant has no Didit webhook secret, so signed replays cannot be accepted.');
  const groups = new Map();
  for (const f of fixtures) {
    const g = f.setup_group || f.id;
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g).push(f);
  }
  const out = {};
  await mapLimit([...groups.values()], 4, async (list) => {
    list.sort((a, b) => (a.order || 0) - (b.order || 0));
    const ctx = await setupGroup(E, tenant.id, list);
    try {
      for (const f of list) {
        const result = { snapshot: null, http_status: null, error: null };
        try {
          const body = fill(f.payload, { ...ctx, event_id: `reg-${tag}-${f.order}-${Math.random().toString(36).slice(2, 7)}` });
          result.http_status = await postSigned(origin, tenant, body);
          await sleep(f.kind === 'transaction' ? 6000 : 3500);
        } catch (e) {
          result.error = String(e?.message || e).slice(0, 300);
        }
        result.snapshot = await snapshot(E, tenant.id, ctx);
        out[f.id] = result;
      }
    } finally {
      await cleanupGroup(E, tenant.id, ctx);
      await audit(E, tenant.id, actorName, 'tm_regression_cleanup', { client_id: ctx.client_id }, {}, `Regression replay ${tag}: test records removed.`);
    }
  });
  return out;
}