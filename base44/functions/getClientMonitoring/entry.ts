// getClientMonitoring — read model for the client Monitoring tab (risk, profile vs actual, chart, coverage, timeline).
// Auth: signed-in user with createRunCase; tenant comes from the user. Requires tm_core.
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.52';
import { isTmEnabled } from '../../shared/tmGuards.js';
import { authenticate, errorResponse, httpError, loadTenant, asList } from '../../shared/tmAuth.js';
import { fetchAll } from '../../shared/tmCoverage.js';
import { summariseTxns, countableTxns, amountInReporting, profileLimits, compareToProfile } from '../../shared/tmActuals.js';

const CREATE_RUN_CASE = ['Analyst', 'QC Reviewer', 'Compliance Officer', 'Manager', 'Director', 'Compliance Admin', 'Tenant Admin'];
const DAY_MS = 86400000;
const OPEN_TM_CASE = ['open', 'investigating', 'pending_co'];
const EDR_CLOSED = ['Approved', 'Closed', 'Rejected'];
const SKIP_AUDIT = ['customer_risk_recomputed', 'tm_alert_created', 'tm_alert_updated', 'expected_profile_approved'];

function sixMonthKeys() {
  const keys = [];
  const d = new Date();
  d.setUTCDate(1);
  for (let i = 5; i >= 0; i--) {
    const m = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - i, 1));
    keys.push(m.toISOString().slice(0, 7));
  }
  return keys;
}

function buildTimeline({ cases, profiles, alerts, scores, audits }) {
  const items = [];
  for (const c of cases) {
    if (c.sign_off_approved_at) items.push({ at: c.sign_off_approved_at, kind: 'kyc_signoff', title: `KYC case signed off (${(c.case_type || '').replace(/_/g, ' ')})`, detail: c.sign_off_approved_by ? `By ${c.sign_off_approved_by}` : '' });
  }
  for (const p of profiles) {
    if (p.approved_at && p.status !== 'proposed') items.push({ at: p.approved_at, kind: 'profile', title: `Expected profile v${p.version} ${p.status}`, detail: p.approved_by_name ? `By ${p.approved_by_name}` : '' });
  }
  for (const a of alerts) items.push({ at: a.created_date, kind: 'alert', title: `TM alert: ${a.title || 'Alert'}`, detail: `${a.source === 'profile_deviation' ? 'Profile deviation · ' : ''}${a.status}` });
  const asc = [...scores].sort((a, b) => String(a.computed_at).localeCompare(String(b.computed_at)));
  asc.forEach((s, i) => {
    const prev = asc[i - 1];
    if (!prev || prev.band !== s.band) items.push({ at: s.computed_at, kind: 'risk', title: `Customer risk ${prev ? `${prev.band} → ` : ''}${s.band} (${s.score})`, detail: (s.reasons || []).slice(0, 2).join(' ') });
  });
  for (const e of audits) {
    if (SKIP_AUDIT.includes(e.event_type)) continue;
    items.push({ at: e.created_date, kind: 'audit', title: String(e.event_type || '').replace(/_/g, ' '), detail: [e.actor_name, e.notes].filter(Boolean).join(' · ').slice(0, 200) });
  }
  return items.filter((i) => i.at).sort((a, b) => String(b.at).localeCompare(String(a.at))).slice(0, 80);
}

export default async function (req) {
  try {
    const base44 = createClientFromRequest(req);
    const body = await req.json();
    const auth = await authenticate(base44, req, body, { roles: CREATE_RUN_CASE, allowApiKey: false });
    const tenantId = auth.tenantId;
    const E = base44.asServiceRole.entities;
    if (!body.client_id) throw httpError(400, 'client_id is required');
    const tenant = await loadTenant(base44, tenantId);
    if (!isTmEnabled(tenant, 'tm_core')) throw httpError(403, 'Feature tm_core is not enabled');
    const client = asList(await E.Client.filter({ tenant_id: tenantId, id: body.client_id }))[0];
    if (!client) throw httpError(404, 'Client not found');
    const cid = client.id;
    const cur = tenant.tm_reporting_currency || 'USD';
    const now = Date.now();
    const since30 = new Date(now - 30 * DAY_MS).toISOString();
    const months = sixMonthKeys();
    const since6m = `${months[0]}-01T00:00:00.000Z`;

    const [profiles, scores, cases, alerts, audits, hits, outreach, coverage, tmCases, txns6m, fxMissing] = await Promise.all([
      E.ExpectedProfile.filter({ tenant_id: tenantId, client_id: cid }, '-version', 50).then(asList),
      E.CustomerRiskScore.filter({ tenant_id: tenantId, client_id: cid }, '-computed_at', 200).then(asList),
      E.KycCase.filter({ tenant_id: tenantId, client_id: cid }, '-created_date', 100).then(asList),
      E.TmAlert.filter({ tenant_id: tenantId, client_id: cid }, '-created_date', 100).then(asList),
      E.AuditEvent.filter({ tenant_id: tenantId, client_id: cid }, '-created_date', 100).then(asList),
      E.ScreeningHit.filter({ tenant_id: tenantId, client_id: cid }, undefined, 200).then(asList),
      E.OutreachRequest.filter({ tenant_id: tenantId, client_id: cid }, undefined, 100).then(asList),
      E.CoverageDay.filter({ tenant_id: tenantId, client_id: cid, date: { $gte: new Date(now - 30 * DAY_MS).toISOString().slice(0, 10) } }, undefined, 1000).then(asList),
      E.TmCase.filter({ tenant_id: tenantId, client_ids: cid, status: { $in: OPEN_TM_CASE } }, '-created_date', 5).then(asList),
      fetchAll((cursor) => E.Transaction.filter({ tenant_id: tenantId, client_id: cid, direction: 'inbound', executed_at: { $gte: since6m } }, { limit: 1000, cursor }), 20),
      // Fiat transactions in the 6-month view that have no fx block (excluded from reporting-currency totals).
      E.Transaction.count({ tenant_id: tenantId, client_id: cid, currency_kind: 'fiat', executed_at: { $gte: since6m }, $or: [{ fx: { $exists: false } }, { fx: null }] }),
    ]);

    const profile = profiles.find((p) => p.status === 'approved') || null;
    const limits = profile ? await profileLimits(base44, tenantId, profile, cur) : null;

    // Monthly inbound (reporting currency), excluding own transfers and reversed bookings.
    const monthly = Object.fromEntries(months.map((m) => [m, 0]));
    for (const t of countableTxns(txns6m)) {
      const k = String(t.executed_at || '').slice(0, 7);
      const a = amountInReporting(t, cur);
      if (k in monthly && a != null) monthly[k] += a;
    }

    const last30 = txns6m.filter((t) => (t.executed_at || '') >= since30);
    const outbound30 = await E.Transaction.filter({ tenant_id: tenantId, client_id: cid, direction: 'outbound', executed_at: { $gte: since30 } }, undefined, 1000).then(asList);
    const actuals = summariseTxns([...last30, ...outbound30], { client, reportingCurrency: cur });
    const cmp = profile ? compareToProfile(actuals, limits, profile.allowed_countries, cur) : { ratios: [], breaches: [], newCountries: [] };

    const current = scores[0] || null;
    const ref = scores.find((s) => s.computed_at && s.computed_at <= since30) || scores[scores.length - 1] || null;
    const covered = new Set(coverage.filter((c) => ['received', 'processed', 'reviewed'].includes(c.state)).map((c) => c.date)).size;

    const confirmed = hits.some((h) => h.status === 'Confirmed_Match' && ['PEP_List', 'Sanctions_EU', 'Sanctions_UN'].includes(h.source));
    const potential = hits.some((h) => ['New', 'Under_Review', 'Escalated'].includes(h.status) && ['PEP_List', 'Sanctions_EU', 'Sanctions_UN'].includes(h.source));
    const openEdr = cases.find((c) => c.case_type === 'Event_Driven_Review' && !EDR_CLOSED.includes(c.status));

    return Response.json({
      reporting_currency: cur,
      risk: current ? {
        score: current.score, band: current.band, components: current.components, reasons: current.reasons || [], computed_at: current.computed_at,
        reference_score: ref && ref.id !== current.id ? ref.score : null,
        delta_30d: ref && ref.id !== current.id ? current.score - ref.score : null,
        history: [...scores].reverse().slice(-60).map((s) => ({ at: s.computed_at, score: s.score, band: s.band })),
      } : null,
      pills: {
        kyc_status: cases[0]?.status || client.status,
        idv_verified: outreach.some((r) => (r.items || []).some((i) => i.idv_status === 'Pass')),
        screening: confirmed ? 'confirmed' : potential ? 'potential' : 'clear',
        ongoing_screening: client.didit_ongoing_monitoring === 'Active',
      },
      profile: profile ? {
        id: profile.id, version: profile.version, approved_at: profile.approved_at, currency: profile.currency,
        inbound_max_month: limits.inbound, inbound_max_count_month: profile.inbound_max_count_month ?? null,
        allowed_countries: profile.allowed_countries || [],
      } : null,
      actual: {
        inbound: actuals.inbound, inbound_count: actuals.inboundCount, countries: actuals.countries,
        new_countries: cmp.newCountries, breaches: cmp.breaches.map((b) => b.key), unconverted: actuals.unconverted,
      },
      coverage: { covered, of: 30 },
      fx_missing: Number(fxMissing) || 0,
      monthly: months.map((m) => ({ month: m, inbound: Math.round(monthly[m]) })),
      open_tm_case: tmCases[0] ? { id: tmCases[0].id, case_ref: tmCases[0].case_ref } : null,
      open_edr_case_id: openEdr?.id || null,
      timeline: buildTimeline({ cases, profiles, alerts, scores, audits }),
    });
  } catch (error) {
    console.error('getClientMonitoring error:', error?.message);
    return errorResponse(error);
  }
}