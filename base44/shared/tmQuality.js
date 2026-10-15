// Shared helpers for TM independent quality control (runQualitySample, completeQualitySample, scenarioRelease).
// Keep QUALITY_ROLES in sync with tmQuality, RELEASE_ROLES with tmQuality + Director/Compliance Officer in src/lib/permissions.js.
import { asList, httpError } from './tmAuth.js';

export const QUALITY_ROLES = ['QC Reviewer', 'Compliance Officer', 'Director']; // tmQuality
export const RELEASE_ROLES = ['Compliance Officer', 'Director'];
export const CLOSED = ['closed_false_positive', 'closed_no_action'];
export const MAX_POPULATION = 5000;
export const DEFAULT_MAX_WRONGLY_CLOSED_PCT = 2;
export const REVIEW_OUTCOMES = { below_the_line: ['ok', 'missed_signal'], file_review: ['ok', 'wrongly_closed'] };

export const dayStart = (d) => `${d}T00:00:00.000Z`;
export const dayEnd = (d) => `${d}T23:59:59.999Z`;

export function checkPeriod(from, to) {
  const ok = (d) => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d) && !Number.isNaN(Date.parse(d));
  if (!ok(from) || !ok(to)) throw httpError(400, 'period_from and period_to must be dates (YYYY-MM-DD)');
  if (from > to) throw httpError(400, 'period_from must be on or before period_to');
}

export function pickRandom(arr, n) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = crypto.getRandomValues(new Uint32Array(1))[0] % (i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a.slice(0, n);
}

/** Pages through a filter until done or `cap` rows. Returns { rows, truncated }. */
export async function fetchAll(entity, query, sort, cap = MAX_POPULATION) {
  const rows = [];
  let cursor;
  while (rows.length < cap) {
    const page = await entity.filter(query, { sort, limit: Math.min(1000, cap - rows.length), ...(cursor ? { cursor } : {}) });
    rows.push(...asList(page));
    if (!page?.has_more || !page.next_cursor) return { rows, truncated: false };
    cursor = page.next_cursor;
  }
  return { rows, truncated: true };
}

/** Scenario owner: owner of an active/test rule on the scenario, else the owner of its risk. */
export async function scenarioOwner(E, tenantId, scenario) {
  if (!scenario) return null;
  const rules = asList(await E.TmRule.filter({ tenant_id: tenantId, scenario_id: scenario.id }, '-created_date', 20));
  const ruleOwner = (rules.find((r) => ['active', 'test'].includes(r.mode) && r.owner_user_id) || rules.find((r) => r.owner_user_id))?.owner_user_id;
  if (ruleOwner) return ruleOwner;
  if (!scenario.risk_id) return null;
  const risk = asList(await E.TmRisk.filter({ tenant_id: tenantId, id: scenario.risk_id }))[0];
  return risk?.owner_user_id || null;
}

export async function loadSample(E, tenantId, id) {
  if (!id) throw httpError(400, 'sample_id is required');
  const s = asList(await E.QualitySample.filter({ tenant_id: tenantId, id }))[0];
  if (!s || s.tenant_id !== tenantId) throw httpError(404, 'Sample not found');
  return s;
}

const ENTITY_FOR_PREFIX = { alert: 'TmAlert', txn: 'Transaction', cp: 'Counterparty', profile: 'ExpectedProfile' };

/** Which of the given source refs ("txn:<id>") exist in this tenant. Returns a Set of the resolving refs. */
export async function resolveRefs(E, tenantId, refs) {
  const byPrefix = {};
  for (const r of new Set(refs)) {
    const [prefix, ...rest] = String(r).split(':');
    const id = rest.join(':');
    if (ENTITY_FOR_PREFIX[prefix] && id) (byPrefix[prefix] ||= []).push(id);
  }
  const found = new Set();
  for (const [prefix, ids] of Object.entries(byPrefix)) {
    for (let i = 0; i < ids.length; i += 100) {
      const part = ids.slice(i, i + 100);
      const rows = asList(await E[ENTITY_FOR_PREFIX[prefix]].filter({ tenant_id: tenantId, id: { $in: part } }, undefined, 100));
      rows.forEach((row) => row.tenant_id === tenantId && found.add(`${prefix}:${row.id}`));
    }
  }
  return found;
}

/** AI shadow comparison for one scenario's alerts. Pure apart from the citation lookup. */
export async function shadowCompare(E, tenantId, alerts) {
  const withProposal = alerts.filter((a) => a.ai_proposal);
  const closeProps = withProposal.filter((a) => a.ai_proposal === 'close');
  const allRefs = withProposal.flatMap((a) => (a.ai_reason_refs || []).flatMap((r) => r.source_refs || []));
  const resolved = await resolveRefs(E, tenantId, allRefs);
  const items = withProposal.map((a) => {
    const refs = (a.ai_reason_refs || []).flatMap((r) => r.source_refs || []);
    const bad = refs.filter((r) => !resolved.has(r)).length;
    let outcome = 'ok';
    let note = '';
    if (a.ai_proposal === 'close' && a.status === 'reported') { outcome = 'wrongly_closed'; note = 'AI proposed close; the alert was later reported.'; }
    else if (a.ai_proposal === 'close' && a.status === 'escalated') { outcome = 'missed_signal'; note = 'AI proposed close; humans escalated.'; }
    else if (bad > 0) { outcome = 'citation_error'; note = `${bad} of ${refs.length} citations do not resolve.`; }
    return { ref_type: 'alert', ref_id: a.id, outcome, note, scenario_id: a.scenario_id, summary: `${a.title || a.id} · AI ${a.ai_proposal} · now ${a.status}` };
  });
  const citationsTotal = allRefs.length;
  const citationsOk = allRefs.filter((r) => resolved.has(r)).length;
  const missed = items.filter((i) => i.outcome === 'missed_signal').length;
  const wrong = items.filter((i) => i.outcome === 'wrongly_closed').length;
  return {
    items,
    metrics: {
      alerts: withProposal.length, close_proposals: closeProps.length, missed, wrongly_closed: wrong,
      citations_total: citationsTotal, citations_ok: citationsOk,
      citations_ok_pct: citationsTotal ? Math.round((citationsOk / citationsTotal) * 1000) / 10 : null,
    },
    findings: missed + wrong + items.filter((i) => i.outcome === 'citation_error').length,
  };
}

/** True when the metrics of a completed ai_shadow sample qualify a release. Returns { ok, reason, pct }. */
export function qualifies(metrics, maxPct) {
  const m = metrics || {};
  if (!m.close_proposals) return { ok: false, reason: 'The sample contains no AI close proposals to measure.' };
  if (m.missed > 0) return { ok: false, reason: `${m.missed} missed alert(s) in the latest sample (must be 0).` };
  const pct = (m.wrongly_closed / m.close_proposals) * 100;
  if (pct > maxPct) return { ok: false, reason: `Wrongly closed is ${pct.toFixed(1)}% (limit ${maxPct}%).`, pct };
  return { ok: true, pct };
}

export const maxWronglyClosedPct = (tenant) => {
  const v = Number(tenant?.tm_settings?.max_wrongly_closed_pct);
  return Number.isFinite(v) && v >= 0 ? v : DEFAULT_MAX_WRONGLY_CLOSED_PCT;
};