// Per-client monitoring check, shared by the nightly profileDeviationJob and by runProfileCheck (right after an upload).
//   1. Expected profile: rolling 30 days up to `now` against the approved ExpectedProfile → profile-deviation alert.
//   2. Change of circumstances for a profile overrun, by tenant setting (decision D7).
//   3. Detection in Vitauri (decision D8, tenant setting, default off): structuring and rapid in/out on our own ledger.
// `now` comes from tmNow.nowFor, so the test clock (as_of) works for Demo tenants / Vitauri Ops.
import { asList } from './tmAuth.js';
import { fetchAll } from './tmCoverage.js';
import { summariseTxns, profileLimits, compareToProfile, amountInReporting } from './tmActuals.js';
import { upsertDeviationAlert } from './tmDeviationAlert.js';
import { proposeTriggers } from './edrTriggers.js';
import { scheduleAutoTriage } from './tmAutoTriage.js';
import { safeAlertRef } from './tmRefs.js';
import {
  detectionSettings, riskClassOf, detectStructuring, detectRapidInOut, monthlyInbound, profileCocDue,
} from './tmDetection.js';

const DAY_MS = 86400000;
const SYSTEM = { actor_type: 'System', actor_name: 'Vitauri detection' };
const LOOKBACK_DAYS = 100; // covers the CoC months and the detection windows

/** True when the client has a confirmed PEP screening hit. */
export async function isConfirmedPep(E, tenantId, clientId) {
  const hits = asList(await E.ScreeningHit.filter({ tenant_id: tenantId, client_id: clientId, status: 'Confirmed_Match' }, undefined, 50).catch(() => []));
  return hits.some((h) => /pep/i.test(String(h.source || '')));
}

/** Creates the TmAlert for a Vitauri rule finding unless one with the same key exists (any status). */
export async function upsertRuleAlert(base44, { tenantId, client, finding, waitUntilFn }) {
  const E = base44.asServiceRole.entities;
  const dedupeKey = `${client.id}:vitauri:${finding.key}`;
  const existing = asList(await E.TmAlert.filter({ tenant_id: tenantId, dedupe_key: dedupeKey }, undefined, 1))[0];
  if (existing) return { alert: existing, created: false };
  const nowIso = new Date().toISOString();
  const scenario = finding.scenario_code ? asList(await E.TmScenario.filter({ tenant_id: tenantId, code: finding.scenario_code }))[0] : null;
  const created = await E.TmAlert.create({
    ref: await safeAlertRef(E, tenantId),
    tenant_id: tenantId, client_id: client.id, scenario_id: scenario?.id || undefined,
    title: finding.title, score: finding.score, priority: finding.score, status: 'new',
    indicator_type: scenario?.indicator_type || 'subjective', source: 'vitauri_rule',
    ai_reasons: [finding.reason], transaction_ids: finding.transaction_ids || [],
    executed_at: finding.executed_at || nowIso, received_at: nowIso, discovered_at: nowIso, dedupe_key: dedupeKey,
  });
  await E.AuditEvent.create({
    tenant_id: tenantId, client_id: client.id, ...SYSTEM, event_type: 'tm_alert_created',
    before_state: {}, after_state: { tm_alert_id: created.id, dedupe_key: dedupeKey, score: finding.score, source: 'vitauri_rule', rule: finding.code },
    notes: `Alert created by Vitauri detection (${finding.code}): ${finding.reason}.`,
  });
  if (client.assigned_analyst_id) {
    await E.Notification.create({
      tenant_id: tenantId, user_id: client.assigned_analyst_id, type: 'monitoring_alert', link_client_id: client.id, is_read: false,
      title: `${finding.title}: ${client.full_name}`, body: finding.reason.slice(0, 300),
    }).catch(() => {});
  }
  await scheduleAutoTriage(base44, { tenantId, alertId: created.id, waitUntilFn }).catch(() => {});
  return { alert: created, created: true };
}

/**
 * Runs the checks for one client. `txns` (optional) = the client's transactions of the last 30 days (the nightly job
 * has them already); otherwise they are loaded. Returns
 * { profile_alert, alerts: [{ id, ref, title, source, created }], change_of_circumstances: [{ id, summary }], detection }.
 */
export async function checkClient(base44, { tenant, client, now = new Date(), txns = null, actor, waitUntilFn }) {
  const E = base44.asServiceRole.entities;
  const tid = tenant.id;
  const cur = tenant.tm_reporting_currency || 'USD';
  const cfg = detectionSettings(tenant);
  const nowIso = now.toISOString();
  const since30 = new Date(now.getTime() - 30 * DAY_MS).toISOString();
  const out = { profile_alert: null, alerts: [], change_of_circumstances: [], detection: cfg.enabled };
  const brief = (a, created) => ({ id: a.id, ref: a.ref, title: a.title, source: a.source, created });

  const profile = asList(await E.ExpectedProfile.filter({ tenant_id: tid, client_id: client.id, status: 'approved' }, '-version', 1))[0];
  const needLedger = cfg.enabled || !!profile;
  // One read covers the profile window, the CoC months and the detection windows; never later than `now`.
  let ledger = null;
  const loadLedger = async () => {
    if (!ledger) {
      const from = new Date(now.getTime() - LOOKBACK_DAYS * DAY_MS).toISOString();
      ledger = (await fetchAll((cursor) => E.Transaction.filter({ tenant_id: tid, client_id: client.id, executed_at: { $gte: from, $lte: nowIso } }, { limit: 1000, cursor }), 10));
    }
    return ledger;
  };

  // ── 1 + 2. Expected profile ──
  if (profile) {
    const recent = txns || (await loadLedger()).filter((t) => t.executed_at >= since30);
    const actuals = summariseTxns(recent, { client, reportingCurrency: cur });
    const limits = await profileLimits(base44, tid, profile, cur);
    const cmp = compareToProfile(actuals, limits, profile.allowed_countries, cur);
    if (cmp.breaches.length || cmp.newCountries.length) {
      const r = await upsertDeviationAlert(base44, { tenantId: tid, client, breaches: cmp.breaches, newCountries: cmp.newCountries, windowFrom: since30.slice(0, 10) });
      out.profile_alert = r.alert;
      out.alerts.push(brief(r.alert, r.created));
      const inboundBreach = cmp.breaches.find((b) => b.key === 'inbound');
      const due = profileCocDue({
        mode: cfg.profile_coc_mode, months: cfg.profile_coc_months, hasBreach: cmp.breaches.length > 0, now,
        inboundLimit: limits.inbound,
        inboundByMonth: cfg.profile_coc_mode === 'structural' && limits.inbound != null ? monthlyInbound(await loadLedger(), (t) => amountInReporting(t, cur)) : {},
      });
      if (due) {
        const summary = cfg.profile_coc_mode === 'structural'
          ? `Expected profile exceeded in each of the last ${cfg.profile_coc_months} months (${inboundBreach?.reason || r.alert.title})`
          : `Expected profile exceeded: ${cmp.breaches.map((b) => b.reason).join('; ')}`;
        const made = await proposeTriggers(E, {
          tenantId: tid, client, sourceRef: `tm_alert:${r.alert.id}`, actor,
          findings: [{ type: 'profile_breach', key: `profile_breach:${r.alert.id}`, before: {}, after: { tm_alert_id: r.alert.id, score: r.alert.score, mode: cfg.profile_coc_mode }, summary }],
        });
        out.change_of_circumstances.push(...made.map((t) => ({ id: t.id, summary })));
      }
    }
  }

  // ── 3. Detection in Vitauri ──
  if (cfg.enabled && needLedger) {
    const all = await loadLedger();
    const riskClass = riskClassOf(client, { pep: await isConfirmedPep(E, tid, client.id) });
    const findings = [
      ...detectStructuring(all, cfg, riskClass),
      ...detectRapidInOut(all, cfg, client.client_type === 'ORG' ? client.registered_country : client.country_of_residence),
    ];
    for (const f of findings) {
      const r = await upsertRuleAlert(base44, { tenantId: tid, client, finding: f, waitUntilFn });
      out.alerts.push(brief(r.alert, r.created));
    }
  }
  return out;
}
