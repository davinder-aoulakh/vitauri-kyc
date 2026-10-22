// Event-driven review (EDR) trigger detection: compares the current KYC file with the snapshot in the client's latest
// approved kyc_approval Decision, plus screening and profile-deviation signals. Creates EdrTrigger proposals only.
import { asList } from './tmAuth.js';

export const TRIGGER_LABEL = {
  ubo_change: 'UBO change', director_change: 'Director change', business_activity_change: 'Business activity change',
  country_change: 'Country change', screening_hit: 'Confirmed screening hit', risk_band_rise: 'Risk band rise',
  profile_breach: 'Profile breach', tm_case: 'TM case',
};

const OWNERSHIP_PP = 10;
const BREACH_SCORE = 70; // deviation score = 40 + maxRatio * 20, so > 70 means a ratio above 150%
const DEVIATION_ACTOR = 'Profile Deviation Job';
const CLIENT_FIELDS = { business_activity: 'business_activity_change', sector: 'business_activity_change', country_of_residence: 'country_change', registered_country: 'country_change' };

export const roleKind = (role) => (/ubo|beneficial/i.test(role || '') ? 'ubo' : /director|board/i.test(role || '') ? 'director' : null);
const norm = (v) => String(v ?? '').trim().toLowerCase();
const hash = (s) => { let h = 5381; for (const ch of String(s)) h = ((h * 33) ^ ch.charCodeAt(0)) >>> 0; return h.toString(36); };
const kindType = (k) => (k === 'ubo' ? 'ubo_change' : 'director_change');
const day = (iso) => String(iso || '').slice(0, 10);

/** Latest approved kyc_approval Decision for a client (the baseline), or null. */
export async function latestBaseline(E, tenantId, clientId) {
  return asList(await E.Decision.filter({ tenant_id: tenantId, client_id: clientId, decision_type: 'kyc_approval', outcome: 'approved' }, '-decided_at', 1))[0] || null;
}

/** Current UBOs/directors of a client: [{ id, full_name, role, ownership_percentage, kind }]. */
export async function currentParties(E, tenantId, clientId) {
  const links = asList(await E.ClientRelatedPartyLink.filter({ tenant_id: tenantId, client_id: clientId }, undefined, 200));
  const ids = [...new Set(links.map((l) => l.related_party_id).filter(Boolean))];
  const parties = ids.length ? asList(await E.RelatedParty.filter({ tenant_id: tenantId, id: { $in: ids } }, undefined, 200)) : [];
  const byId = new Map(parties.map((p) => [p.id, p]));
  return links.filter((l) => byId.has(l.related_party_id)).map((l) => {
    const p = byId.get(l.related_party_id);
    const role = l.role || p.role_in_relationship || null;
    return { id: p.id, full_name: p.full_name, role, ownership_percentage: l.ownership_percentage ?? p.ownership_percentage ?? null, kind: roleKind(role) };
  });
}

/** Findings from comparing the current client + parties with a baseline snapshot. */
export function diffAgainstBaseline(decision, client, parties) {
  const snap = decision.snapshot || {};
  const base = (snap.related_parties || []).map((p) => ({ ...p, kind: roleKind(p.role) }));
  const out = [];
  const tag = decision.id;

  for (const [field, type] of Object.entries(CLIENT_FIELDS)) {
    if (!snap.client || !(field in snap.client)) continue;
    const before = snap.client[field] ?? null;
    const after = client[field] ?? null;
    if (norm(before) === norm(after)) continue;
    out.push({ type, key: `${type}:${field}:${tag}:${hash(norm(after))}`, before: { [field]: before }, after: { [field]: after },
      summary: `${field.replace(/_/g, ' ')} changed from "${before || '—'}" to "${after || '—'}"` });
  }

  const baseKey = (p) => `${p.id}:${p.kind}`;
  const nowKeys = new Set(parties.filter((p) => p.kind).map(baseKey));
  const baseKeys = new Set(base.filter((p) => p.kind).map(baseKey));
  for (const p of parties.filter((x) => x.kind && !baseKeys.has(baseKey(x)))) {
    out.push({ type: kindType(p.kind), key: `${kindType(p.kind)}:added:${p.id}:${tag}`, before: {}, after: { related_party_id: p.id, full_name: p.full_name, role: p.role, ownership_percentage: p.ownership_percentage },
      summary: `${p.kind === 'ubo' ? 'UBO' : 'Director'} added: ${p.full_name}` });
  }
  for (const p of base.filter((x) => x.kind && !nowKeys.has(baseKey(x)))) {
    out.push({ type: kindType(p.kind), key: `${kindType(p.kind)}:removed:${p.id}:${tag}`, before: { related_party_id: p.id, full_name: p.full_name, role: p.role, ownership_percentage: p.ownership_percentage }, after: {},
      summary: `${p.kind === 'ubo' ? 'UBO' : 'Director'} removed: ${p.full_name}` });
  }
  for (const p of parties.filter((x) => x.kind === 'ubo')) {
    const b = base.find((x) => x.id === p.id && x.kind === 'ubo');
    if (!b) continue;
    const delta = Math.abs((Number(p.ownership_percentage) || 0) - (Number(b.ownership_percentage) || 0));
    if (delta >= OWNERSHIP_PP) {
      out.push({ type: 'ubo_change', key: `ubo_change:ownership:${p.id}:${tag}:${p.ownership_percentage ?? 0}`,
        before: { related_party_id: p.id, ownership_percentage: b.ownership_percentage ?? null }, after: { related_party_id: p.id, ownership_percentage: p.ownership_percentage ?? null },
        summary: `Ownership of ${p.full_name} changed from ${b.ownership_percentage ?? 0}% to ${p.ownership_percentage ?? 0}%` });
    }
  }
  return out;
}

/** Confirmed screening hits on the client since the baseline approval. */
export async function screeningFindings(E, tenantId, clientId, decision) {
  const since = decision.decided_at || decision.created_date;
  const hits = asList(await E.ScreeningHit.filter({ tenant_id: tenantId, client_id: clientId, status: 'Confirmed_Match' }, undefined, 100));
  return hits.filter((h) => String(h.updated_date || h.created_date) > String(since)).map((h) => ({
    type: 'screening_hit', key: `screening_hit:${h.id}`, before: {}, after: { screening_hit_id: h.id, source: h.source || null, hit_name: h.hit_name || null },
    summary: `Confirmed ${String(h.source || 'screening').replace(/_/g, ' ')} match${h.hit_name ? `: ${h.hit_name}` : ''}`,
  }));
}

/**
 * Open profile-deviation alert above 150% that the deviation job raised or refreshed on two consecutive days.
 * The alert keeps one merged score, so consecutive runs are read from the job's daily AuditEvents on the client.
 */
export async function profileBreachFindings(E, tenantId, clientId) {
  const alert = asList(await E.TmAlert.filter({ tenant_id: tenantId, client_id: clientId, source: 'profile_deviation', status: { $in: ['new', 'triaged', 'in_review', 'escalated'] } }, '-created_date', 1))[0];
  if (!alert || (alert.score || 0) <= BREACH_SCORE) return [];
  const since = new Date(Date.now() - 4 * 86400000).toISOString();
  const events = asList(await E.AuditEvent.filter({ tenant_id: tenantId, client_id: clientId, actor_name: DEVIATION_ACTOR, event_type: { $in: ['tm_alert_created', 'tm_alert_updated'] }, created_date: { $gte: since } }, '-created_date', 20));
  const days = [...new Set(events.map((e) => day(e.created_date)))].sort().reverse();
  const consecutive = days.length >= 2 && (new Date(days[0]).getTime() - new Date(days[1]).getTime()) === 86400000;
  if (!consecutive) return [];
  return [{ type: 'profile_breach', key: `profile_breach:${alert.id}`, before: {}, after: { tm_alert_id: alert.id, score: alert.score },
    summary: `Expected profile exceeded by more than 150% on consecutive daily runs (${alert.title || 'profile deviation'})` }];
}

/** Recipients: the client's assigned analyst, else the tenant's Compliance Officers. */
async function recipients(E, tenantId, client) {
  if (client.assigned_analyst_id) return [client.assigned_analyst_id];
  const users = asList(await E.User.filter({ tenant_id: tenantId }, undefined, 1000));
  return users.filter((u) => (u.app_role || u.data?.app_role) === 'Compliance Officer' && (u.tenant_id || u.data?.tenant_id) === tenantId).map((u) => u.id);
}

/**
 * Create one EdrTrigger per finding unless a trigger with the same dedupe_key exists (proposed, or already decided for
 * this baseline and value), notify and audit. actor: { actorType, actorName, actorUserId }. Returns created triggers.
 */
export async function proposeTriggers(E, { tenantId, client, findings, sourceRef, actor }) {
  const created = [];
  for (const f of findings) {
    const dedupeKey = `${client.id}:${f.key}`;
    const existing = asList(await E.EdrTrigger.filter({ tenant_id: tenantId, dedupe_key: dedupeKey }, undefined, 1))[0];
    if (existing) continue;
    const t = await E.EdrTrigger.create({
      tenant_id: tenantId, client_id: client.id, trigger_type: f.type, source_ref: f.source_ref || sourceRef || undefined,
      before: f.before || {}, after: { ...(f.after || {}), summary: f.summary }, status: 'proposed', dedupe_key: dedupeKey,
    });
    created.push(t);
    const label = TRIGGER_LABEL[f.type] || f.type;
    const to = await recipients(E, tenantId, client);
    if (to.length) {
      await E.Notification.bulkCreate(to.map((uid) => ({
        tenant_id: tenantId, user_id: uid, type: 'edr_trigger', link_client_id: client.id, is_read: false,
        title: `Event-driven review proposed: ${client.full_name}`, body: `${label}: ${f.summary}`,
      }))).catch(() => {});
    }
    await E.AuditEvent.create({
      tenant_id: tenantId, client_id: client.id, actor_user_id: actor?.actorUserId, actor_name: actor?.actorName || 'System',
      actor_type: actor?.actorType || 'System', event_type: 'edr_trigger_proposed',
      before_state: {}, after_state: { edr_trigger_id: t.id, trigger_type: f.type, dedupe_key: dedupeKey },
      notes: `EDR trigger proposed (${label}): ${f.summary}.`,
    });
  }
  return created;
}
