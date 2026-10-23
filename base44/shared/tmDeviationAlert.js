// Create or merge the open 'profile_deviation' TmAlert (scenario S-30) for a client.
import { asList } from './tmAuth.js';
import { scheduleAutoTriage } from './tmAutoTriage.js';

const OPEN = ['new', 'triaged', 'in_review'];
const SYSTEM = { actor_type: 'System', actor_name: 'Profile Deviation Job' };

export async function upsertDeviationAlert(base44, { tenantId, client, breaches, newCountries, windowFrom }) {
  const E = base44.asServiceRole.entities;
  const nowIso = new Date().toISOString();
  const dedupeKey = `${client.id}:S-30:profile_deviation`;
  const reasons = [...breaches.map((b) => b.reason), ...(newCountries.length ? [`New countries: ${newCountries.join(', ')}`] : [])];
  const maxRatio = breaches.reduce((m, b) => Math.max(m, b.ratio), newCountries.length ? 1.2 : 0);
  const score = Math.min(100, Math.round(40 + maxRatio * 20));
  const title = `Profile deviation: ${[...breaches.map((b) => b.label.toLowerCase()), ...(newCountries.length ? ['new countries'] : [])].join(', ')}`;

  const existing = asList(await E.TmAlert.filter({ tenant_id: tenantId, dedupe_key: dedupeKey, status: { $in: OPEN } }))[0];
  if (existing) {
    const patch = { ai_reasons: reasons, score: Math.max(existing.score || 0, score), title, priority: Math.max(existing.priority || 0, score) };
    await E.TmAlert.update(existing.id, patch);
    await E.AuditEvent.create({
      tenant_id: tenantId, client_id: client.id, ...SYSTEM, event_type: 'tm_alert_updated',
      before_state: { ai_reasons: existing.ai_reasons || [], score: existing.score ?? null },
      after_state: { ai_reasons: reasons, score: patch.score },
      notes: `Profile deviation alert ${existing.id} updated (window from ${windowFrom}).`,
    });
    return { alert: { ...existing, ...patch }, created: false };
  }

  const scenario = asList(await E.TmScenario.filter({ tenant_id: tenantId, code: 'S-30' }))[0];
  const created = await E.TmAlert.create({
    ref: await safeAlertRef(E, tenantId),
    tenant_id: tenantId, client_id: client.id, scenario_id: scenario?.id || undefined, title, score, priority: score,
    status: 'new', indicator_type: scenario?.indicator_type || 'subjective', source: 'profile_deviation',
    ai_reasons: reasons, executed_at: nowIso, received_at: nowIso, discovered_at: nowIso, dedupe_key: dedupeKey,
  });
  await E.AuditEvent.create({
    tenant_id: tenantId, client_id: client.id, ...SYSTEM, event_type: 'tm_alert_created',
    before_state: {}, after_state: { tm_alert_id: created.id, dedupe_key: dedupeKey, score, source: 'profile_deviation' },
    notes: `Profile deviation alert created: ${reasons.join('; ')}.`,
  });
  if (client.assigned_analyst_id) {
    await E.Notification.create({
      tenant_id: tenantId, user_id: client.assigned_analyst_id, type: 'monitoring_alert', link_client_id: client.id, is_read: false,
      title: `Profile deviation: ${client.full_name}`, body: reasons.slice(0, 3).join(' · '),
    }).catch(() => {});
  }
  await scheduleAutoTriage(base44, { tenantId, alertId: created.id });
  return { alert: created, created: true };
}