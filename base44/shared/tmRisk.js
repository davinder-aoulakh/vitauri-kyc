// Dynamic customer risk: weighted KYC + behaviour + screening + alerts. Never touches Client.risk_classification.
import { asList } from './tmAuth.js';
import { loadActuals, profileLimits, compareToProfile, OPEN_ALERT_STATUSES } from './tmActuals.js';

const DEFAULT_WEIGHTS = { kyc: 0.35, behaviour: 0.25, screening: 0.2, alerts: 0.2 };
const KYC_POINTS = { Low: 20, Medium: 45, High: 75, Unacceptable: 100 };
const BANDS = ['Low', 'Medium', 'High', 'Unacceptable'];
const OPEN_EDR_EXCLUDED = ['Approved', 'Closed', 'Rejected'];
const LIST_SOURCES = ['PEP_List', 'Sanctions_EU', 'Sanctions_UN'];

export const bandFor = (score) => (score < 35 ? 'Low' : score < 60 ? 'Medium' : score < 85 ? 'High' : 'Unacceptable');
const clamp = (n) => Math.max(0, Math.min(100, n));

function behaviourComponent({ profile, cmp, actuals, cur }) {
  if (!profile) return { score: 50, reasons: ['No approved expected profile: behaviour scored at 50.'] };
  const reasons = [];
  const maxRatio = cmp.ratios.reduce((m, r) => Math.max(m, r.ratio), 0);
  let score = maxRatio > 1 ? clamp((maxRatio - 1) * 100) : 0;
  for (const b of cmp.breaches) reasons.push(b.reason);
  if (cmp.newCountries.length) {
    score += 20 * cmp.newCountries.length;
    reasons.push(`New countries outside the profile: ${cmp.newCountries.join(', ')}.`);
  }
  if (!reasons.length) reasons.push(`Activity in the last 30 days is within the approved profile (${cur} ${Math.round(actuals.inbound).toLocaleString('en-US')} inbound).`);
  return { score: clamp(score), reasons };
}

async function screeningComponent(E, tenantId, clientId, txnCounterpartyIds) {
  const hits = asList(await E.ScreeningHit.filter({ tenant_id: tenantId, client_id: clientId }, undefined, 500));
  const cps = txnCounterpartyIds.length
    ? asList(await E.Counterparty.filter({ tenant_id: tenantId, id: { $in: txnCounterpartyIds } }, undefined, 500)) : [];
  const confirmed = hits.some((h) => h.status === 'Confirmed_Match' && LIST_SOURCES.includes(h.source));
  const cpConfirmed = cps.some((c) => c.screening_status === 'confirmed_match');
  if (confirmed || cpConfirmed) return { score: 100, reasons: [confirmed ? 'Confirmed PEP/sanctions hit on the client.' : 'Confirmed screening match on a counterparty.'] };
  const open = hits.filter((h) => ['New', 'Under_Review', 'Escalated'].includes(h.status) && LIST_SOURCES.includes(h.source)).length;
  const cpOpen = cps.filter((c) => c.screening_status === 'potential_match').length;
  if (open || cpOpen) return { score: 60, reasons: [`${open + cpOpen} potential screening match(es) still open.`] };
  return { score: 0, reasons: [] };
}

function alertsComponent(alerts) {
  const open = alerts.filter((a) => ['new', 'triaged', 'in_review'].includes(a.status)).length;
  const esc = alerts.filter((a) => a.status === 'escalated').length;
  const reasons = [];
  if (open) reasons.push(`${open} open TM alert(s).`);
  if (esc) reasons.push(`${esc} escalated TM alert(s).`);
  return { score: clamp(open * 15 + esc * 30), reasons };
}

/**
 * Recompute and persist the dynamic risk score for one client. Caller must already have verified tenant scope.
 * actor: { actorType, actorName, actorUserId }
 */
export async function recomputeCustomerRisk(base44, { tenantId, tenant, clientId, trigger = 'manual', actor }) {
  const E = base44.asServiceRole.entities;
  const client = asList(await E.Client.filter({ tenant_id: tenantId, id: clientId }))[0];
  if (!client) throw Object.assign(new Error('Client not found'), { status: 404 });

  const cur = tenant.tm_reporting_currency || 'USD';
  const weights = { ...DEFAULT_WEIGHTS, ...(tenant.tm_settings?.risk_weights || {}) };

  const profiles = asList(await E.ExpectedProfile.filter({ tenant_id: tenantId, client_id: clientId, status: 'approved' }, '-version', 1));
  const profile = profiles[0] || null;
  const actuals = await loadActuals(base44, { tenantId, client, reportingCurrency: cur });
  const cmp = profile
    ? compareToProfile(actuals, await profileLimits(base44, tenantId, profile, cur), profile.allowed_countries, cur)
    : { ratios: [], breaches: [], newCountries: [] };

  const since = new Date(Date.now() - 30 * 86400000).toISOString();
  const recent = asList(await E.Transaction.filter({ tenant_id: tenantId, client_id: clientId, executed_at: { $gte: since }, counterparty_id: { $exists: true } }, { fields: ['counterparty_id'], limit: 500 }));
  const cpIds = [...new Set(recent.map((t) => t.counterparty_id).filter(Boolean))].slice(0, 200);

  const kycScore = KYC_POINTS[client.risk_classification] ?? 45;
  const kyc = { score: kycScore, reasons: [client.risk_classification ? `KYC classification ${client.risk_classification}.` : 'No KYC classification yet: scored as Medium.'] };
  const behaviour = behaviourComponent({ profile, cmp, actuals, cur });
  const screening = await screeningComponent(E, tenantId, clientId, cpIds);
  const alertRows = asList(await E.TmAlert.filter({ tenant_id: tenantId, client_id: clientId, status: { $in: OPEN_ALERT_STATUSES } }, undefined, 500));
  const alerts = alertsComponent(alertRows);

  const score = Math.round(clamp(
    kyc.score * weights.kyc + behaviour.score * weights.behaviour + screening.score * weights.screening + alerts.score * weights.alerts));
  const band = bandFor(score);
  const reasons = [...kyc.reasons, ...behaviour.reasons, ...screening.reasons, ...alerts.reasons];

  const prev = asList(await E.CustomerRiskScore.filter({ tenant_id: tenantId, client_id: clientId }, '-computed_at', 1))[0];
  const nowIso = new Date().toISOString();
  const record = await E.CustomerRiskScore.create({
    tenant_id: tenantId, client_id: clientId, score, band,
    components: { kyc: kyc.score, behaviour: behaviour.score, screening: screening.score, alerts: alerts.score },
    reasons, trigger, computed_at: nowIso,
  });
  await E.Client.update(clientId, { customer_risk_score: score, customer_risk_band: band });

  if (!prev || prev.score !== score || prev.band !== band) {
    await E.AuditEvent.create({
      tenant_id: tenantId, client_id: clientId, actor_user_id: actor?.actorUserId, actor_name: actor?.actorName || 'System',
      actor_type: actor?.actorType || 'System', event_type: 'customer_risk_recomputed',
      before_state: prev ? { score: prev.score, band: prev.band } : {},
      after_state: { score, band, trigger, risk_score_id: record.id },
      notes: `Dynamic customer risk ${prev ? `${prev.score} (${prev.band}) → ` : ''}${score} (${band}). Trigger: ${trigger}.`,
    });
  }

  let edrProposed = false;
  const rose = BANDS.indexOf(band) > BANDS.indexOf(prev?.band || client.customer_risk_band || 'Low');
  if (rose && BANDS.indexOf(band) >= 2) {
    const cases = asList(await E.KycCase.filter({ tenant_id: tenantId, client_id: clientId, case_type: 'Event_Driven_Review' }, undefined, 100));
    if (!cases.some((c) => !OPEN_EDR_EXCLUDED.includes(c.status))) {
      // EdrTrigger proposal (in addition to the notification below). One open proposal per client and band.
      const dedupeKey = `${clientId}:risk_band_rise:${band}`;
      try {
      const openTrigger = asList(await E.EdrTrigger.filter({ tenant_id: tenantId, dedupe_key: dedupeKey, status: 'proposed' }, undefined, 1))[0];
      if (!openTrigger) {
        const trigger = await E.EdrTrigger.create({
          tenant_id: tenantId, client_id: clientId, trigger_type: 'risk_band_rise', source_ref: record.id, status: 'proposed', dedupe_key: dedupeKey,
          before: { score: prev?.score ?? null, band: prev?.band || client.customer_risk_band || null },
          after: { score, band, summary: `Dynamic risk rose to ${band} (${score}). ${reasons.slice(0, 3).join(' ')}` },
        });
        await E.AuditEvent.create({
          tenant_id: tenantId, client_id: clientId, actor_user_id: actor?.actorUserId, actor_name: actor?.actorName || 'System',
          actor_type: actor?.actorType || 'System', event_type: 'edr_trigger_proposed',
          before_state: {}, after_state: { edr_trigger_id: trigger.id, trigger_type: 'risk_band_rise', dedupe_key: dedupeKey },
          notes: `EDR trigger proposed (risk band rise): ${band} (${score}).`,
        });
      }
      } catch (e) {
        console.warn('risk_band_rise EdrTrigger failed:', e?.message);
      }
      const users = asList(await E.User.filter({ tenant_id: tenantId }, undefined, 1000));
      const recipients = new Set(users.filter((u) => ['Compliance Officer', 'Tenant Admin'].includes(u.app_role || u.data?.app_role)).map((u) => u.id));
      if (client.assigned_analyst_id) recipients.add(client.assigned_analyst_id);
      if (recipients.size) {
        await E.Notification.bulkCreate([...recipients].map((uid) => ({
          tenant_id: tenantId, user_id: uid, type: 'edr_proposed', link_client_id: clientId, is_read: false,
          title: `Event-driven review proposed: ${client.full_name}`,
          body: `Dynamic risk rose to ${band} (${score}). ${reasons.slice(0, 3).join(' ')}`,
        })));
        edrProposed = true;
      }
    }
  }
  return { score, band, previous: prev ? { score: prev.score, band: prev.band } : null, components: record.components, reasons, edr_proposed: edrProposed };
}

/** Best-effort wrapper for callers that must never fail because of risk recomputation. */
export async function safeRecompute(base44, args) {
  try { return await recomputeCustomerRisk(base44, args); } catch (e) { console.warn('recomputeCustomerRisk failed:', e?.message); return null; }
}