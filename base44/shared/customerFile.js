// Shared read models: client Monitoring tab + customer file. Read only — nothing here writes records.
// Never call Didit from here; verification results are only read from data already stored in Vitauri.
import { authenticate, httpError, asList, chunk } from './tmAuth.js';
import { fetchAll } from './tmCoverage.js';
import { summariseTxns, countableTxns, amountInReporting, profileLimits, compareToProfile } from './tmActuals.js';

export const CREATE_RUN_CASE = ['Analyst', 'QC Reviewer', 'Compliance Officer', 'Manager', 'Director', 'Compliance Admin', 'Tenant Admin'];
// Same list as the FiuArtefact read rule (plus Vitauri Ops).
export const FIU_READ_ROLES = [...CREATE_RUN_CASE, 'Vitauri Ops'];
export const OPS_ROLE = 'Vitauri Ops';

const DAY_MS = 86400000;
const OPEN_TM_CASE = ['open', 'investigating', 'pending_co'];
const EDR_CLOSED = ['Approved', 'Closed', 'Rejected'];
const SKIP_AUDIT = ['customer_risk_recomputed', 'tm_alert_created', 'tm_alert_updated', 'expected_profile_approved'];
const RECEIVED_STATES = ['received', 'processed', 'reviewed'];
const SECRET_KEY = /secret|api_key|token|password/i;

/** Signed-in allowlisted user of the tenant, or Vitauri Ops (tenant then comes from resolveOpsTenantId). */
export async function authorizeCaller(base44, req, body, resolveOpsTenantId) {
  const user = await base44.auth.me().catch(() => null);
  if (!user) throw httpError(401, 'Unauthorized');
  const role = user.app_role || user.data?.app_role;
  if (role === OPS_ROLE) {
    const tenantId = await resolveOpsTenantId();
    return { tenantId, role };
  }
  const auth = await authenticate(base44, req, body, { roles: CREATE_RUN_CASE, allowApiKey: false });
  return { tenantId: auth.tenantId, role };
}

/** Client copy without Didit, tipping-off or secret-like fields. */
export function stripClient(client) {
  const out = {};
  for (const [k, v] of Object.entries(client || {})) {
    if (k.startsWith('didit_') || k.startsWith('tipping_off_') || SECRET_KEY.test(k)) continue;
    out[k] = v;
  }
  return out;
}

// ---------------------------------------------------------------- Monitoring tab read model

export function sixMonthKeys() {
  const keys = [];
  const d = new Date();
  d.setUTCDate(1);
  for (let i = 5; i >= 0; i--) {
    const m = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - i, 1));
    keys.push(m.toISOString().slice(0, 7));
  }
  return keys;
}

export function buildMonitoringTimeline({ cases, profiles, alerts, scores, audits }) {
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

/** Exact response body of getClientMonitoring. */
export async function buildMonitoringModel(base44, tenantId, tenant, client) {
  const E = base44.asServiceRole.entities;
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
  const covered = new Set(coverage.filter((c) => RECEIVED_STATES.includes(c.state)).map((c) => c.date)).size;

  const confirmed = hits.some((h) => h.status === 'Confirmed_Match' && ['PEP_List', 'Sanctions_EU', 'Sanctions_UN'].includes(h.source));
  const potential = hits.some((h) => ['New', 'Under_Review', 'Escalated'].includes(h.status) && ['PEP_List', 'Sanctions_EU', 'Sanctions_UN'].includes(h.source));
  const openEdr = cases.find((c) => c.case_type === 'Event_Driven_Review' && !EDR_CLOSED.includes(c.status));

  return {
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
    timeline: buildMonitoringTimeline({ cases, profiles, alerts, scores, audits }),
  };
}

// ---------------------------------------------------------------- Customer file

export const FILE_SECTIONS = [
  'client', 'related_parties', 'kyc_cases', 'tm_cases', 'alerts', 'fiu_reports', 'fiu_artefacts',
  'decisions', 'risk_history', 'profiles', 'coverage', 'edr_triggers', 'timeline',
];

const memo = (fn) => { let p; return () => (p ||= fn()); };
const uniq = (arr) => [...new Set(arr.filter(Boolean))];

function partyScreening(hits) {
  if (!hits.length) return 'none';
  if (hits.some((h) => h.status === 'Confirmed_Match')) return 'confirmed';
  if (hits.some((h) => ['New', 'Under_Review', 'Escalated'].includes(h.status))) return 'potential';
  return 'clear';
}

async function loadRelatedParties(E, tenantId, cid) {
  const links = await E.ClientRelatedPartyLink.filter({ tenant_id: tenantId, client_id: cid }, undefined, 200).then(asList);
  const ids = uniq(links.map((l) => l.related_party_id));
  if (!ids.length) return [];
  const [parties, hits] = await Promise.all([
    E.RelatedParty.filter({ tenant_id: tenantId, id: { $in: ids } }, undefined, 200).then(asList),
    E.ScreeningHit.filter({ tenant_id: tenantId, related_party_id: { $in: ids } }, undefined, 500).then(asList),
  ]);
  const byId = Object.fromEntries(parties.map((p) => [p.id, p]));
  return links.filter((l) => byId[l.related_party_id]).map((l) => {
    const p = byId[l.related_party_id];
    return {
      id: p.id, full_name: p.full_name, party_type: p.party_type, registration_number: p.registration_number || null,
      role: l.role || p.role_in_relationship || null,
      ownership_percentage: l.ownership_percentage ?? p.ownership_percentage ?? null,
      nationality: p.nationality || null, country_of_residence: p.country_of_residence || null,
      verification_status: p.verification_status || null,
      risk_classification: p.risk_classification || null,
      screening_status: partyScreening(hits.filter((h) => h.related_party_id === p.id)),
    };
  });
}

async function loadDecisions(E, tenantId, cid, subjectIds) {
  const queries = [E.Decision.filter({ tenant_id: tenantId, client_id: cid }, '-decided_at', 50).then(asList)];
  for (const part of chunk(uniq([cid, ...subjectIds]), 100).slice(0, 3)) {
    queries.push(E.Decision.filter({ tenant_id: tenantId, subject_id: { $in: part } }, '-decided_at', 50).then(asList));
  }
  const all = (await Promise.all(queries)).flat();
  const seen = new Map(all.map((d) => [d.id, d]));
  return [...seen.values()].sort((a, b) => String(b.decided_at || b.created_date).localeCompare(String(a.decided_at || a.created_date))).slice(0, 50);
}

function buildFileTimeline({ cases, profiles, alerts, tmCases, reports, decisions, triggers, scores, cid }) {
  const items = [];
  const add = (at, kind, title, detail, link) => { if (at) items.push({ at, kind, title, detail: detail || '', link: link || null }); };
  for (const c of cases) {
    const type = (c.case_type || '').replace(/_/g, ' ');
    add(c.created_date, 'kyc', `KYC case opened (${type})`, c.status, `/case/${c.id}`);
    add(c.sign_off_approved_at, 'kyc', `KYC case approved (${type})`, c.sign_off_approved_by ? `By ${c.sign_off_approved_by}` : '', `/case/${c.id}`);
  }
  for (const p of profiles) {
    if (p.approved_at && p.status !== 'proposed') add(p.approved_at, 'tm', `Expected profile v${p.version} ${p.status}`, p.approved_by_name ? `By ${p.approved_by_name}` : '', `/client/${cid}`);
  }
  for (const a of alerts) add(a.created_date, 'tm', `TM alert: ${a.title || 'Alert'}`, a.status, '/tm/alerts');
  for (const t of tmCases) {
    add(t.created_date, 'tm', `TM case opened${t.case_ref ? ` ${t.case_ref}` : ''}`, t.status, `/tm/case/${t.id}`);
    add(t.co_decided_at, 'tm', `TM case decided${t.case_ref ? ` ${t.case_ref}` : ''}`, t.co_decision ? String(t.co_decision).replace(/_/g, ' ') : t.status, `/tm/case/${t.id}`);
  }
  for (const r of reports) {
    const link = `/tm/report/${r.id}`;
    const ref = r.report_ref || 'FIU report';
    add(r.created_date, 'fiu', `${ref} prepared`, r.status, link);
    add(r.approved_at, 'fiu', `${ref} approved`, '', link);
    add(r.generated?.at, 'fiu', `${ref} generated`, '', link);
    add(r.submitted?.at, 'fiu', `${ref} submitted`, r.submitted?.method || '', link);
    add(r.received?.at, 'fiu', `${ref} received by FIU`, r.received?.fiu_reference || '', link);
  }
  for (const d of decisions) add(d.decided_at || d.created_date, 'decision', `${String(d.decision_type || '').replace(/_/g, ' ')}: ${d.outcome}`, String(d.rationale || '').slice(0, 200), null);
  for (const t of triggers) {
    const label = String(t.trigger_type || '').replace(/_/g, ' ');
    add(t.created_date, 'trigger', `EDR trigger proposed: ${label}`, '', t.kyc_case_id ? `/case/${t.kyc_case_id}` : `/client/${cid}`);
    if (t.status === 'accepted') add(t.decided_at, 'trigger', `EDR trigger accepted: ${label}`, '', t.kyc_case_id ? `/case/${t.kyc_case_id}` : `/client/${cid}`);
  }
  const asc = [...scores].sort((a, b) => String(a.computed_at).localeCompare(String(b.computed_at)));
  asc.forEach((s, i) => {
    const prev = asc[i - 1];
    if (prev && prev.band !== s.band) add(s.computed_at, 'tm', `Customer risk ${prev.band} → ${s.band} (${s.score})`, (s.reasons || []).slice(0, 2).join(' '), `/client/${cid}`);
  });
  return items.sort((a, b) => String(b.at).localeCompare(String(a.at))).slice(0, 100);
}

/** Full customer file. sections: optional array limiting what is computed. */
export async function buildCustomerFile(base44, { tenantId, client, role, sections }) {
  // `sections` is read below for the opt-in counterparty_hits section.
  const E = base44.asServiceRole.entities;
  const cid = client.id;
  const wanted = Array.isArray(sections) && sections.length ? sections : FILE_SECTIONS;
  const want = (s) => wanted.includes(s);
  const fiuAllowed = FIU_READ_ROLES.includes(role);
  const since30 = new Date(Date.now() - 30 * DAY_MS).toISOString().slice(0, 10);
  const timeline = want('timeline');

  const cases = memo(() => E.KycCase.filter({ tenant_id: tenantId, client_id: cid }, '-created_date', 100).then(asList));
  const profiles = memo(() => E.ExpectedProfile.filter({ tenant_id: tenantId, client_id: cid }, '-version', 50).then(asList));
  const scores = memo(() => E.CustomerRiskScore.filter({ tenant_id: tenantId, client_id: cid }, '-computed_at', 200).then(asList));
  const alerts = memo(() => E.TmAlert.filter({ tenant_id: tenantId, client_id: cid }, '-created_date', 100).then(asList));
  const tmCases = memo(() => E.TmCase.filter({ tenant_id: tenantId, client_ids: cid }, '-created_date', 20).then(asList));
  const reports = memo(async () => (fiuAllowed ? E.FiuReport.filter({ tenant_id: tenantId, client_id: cid }, '-created_date', 20).then(asList) : []));
  const triggers = memo(() => E.EdrTrigger.filter({ tenant_id: tenantId, client_id: cid }, '-created_date', 100).then(asList));
  const decisions = memo(async () => {
    const [c, a, r] = await Promise.all([cases(), alerts(), reports()]);
    return loadDecisions(E, tenantId, cid, [...c, ...a, ...r].map((x) => x.id));
  });

  const out = { client_id: cid };
  const jobs = [];
  const run = (key, fn) => jobs.push(fn().then((v) => { Object.assign(out, key === null ? v : { [key]: v }); }));

  if (want('client')) out.client = stripClient(client);
  if (want('related_parties')) run('related_parties', () => loadRelatedParties(E, tenantId, cid));
  if (want('kyc_cases')) {
    run(null, async () => {
      const list = await cases();
      const latest = list.find((c) => c.status === 'Approved' || c.sign_off_approved_at);
      return {
        kyc_cases: list.map((c) => ({ id: c.id, case_type: c.case_type, status: c.status, risk_classification: c.risk_classification || null, tm_case_id: c.tm_case_id || null, created_date: c.created_date, completed_at: c.completed_at || null })),
        latest_approved_kyc_case_id: latest?.id || null,
      };
    });
  }
  if (want('tm_cases')) run('tm_cases', async () => (await tmCases()).map((t) => ({ id: t.id, case_ref: t.case_ref, status: t.status, alert_ids_count: (t.alert_ids || []).length, assigned_to_user_id: t.assigned_to_user_id || null, due_at: t.due_at || null, kyc_edr_case_id: t.kyc_edr_case_id || null })));
  if (want('alerts')) run('alerts', async () => (await alerts()).slice(0, 50).map((a) => ({ id: a.id, title: a.title, score: a.score ?? null, status: a.status, due_at: a.due_at || null, ai_proposal: a.ai_proposal || null, source: a.source || null, created_date: a.created_date || null })));
  // Opt-in only (not part of the default full file): counterparties on this client's transactions with a screening match.
  if (Array.isArray(sections) && sections.includes('counterparty_hits')) {
    run('counterparty_hits', async () => {
      const txns = await E.Transaction.filter({ tenant_id: tenantId, client_id: cid }, { limit: 1000, fields: ['counterparty_id'] }).then(asList);
      const ids = uniq(txns.map((t) => t.counterparty_id));
      const found = [];
      for (const part of chunk(ids, 100).slice(0, 5)) {
        found.push(...await E.Counterparty.filter({ tenant_id: tenantId, id: { $in: part }, screening_status: { $in: ['potential_match', 'confirmed_match'] } }, undefined, 100).then(asList));
      }
      return found.slice(0, 50).map((c) => ({ id: c.id, display_name: c.display_name, screening_status: c.screening_status }));
    });
  }
  if (want('fiu_reports')) {
    run('fiu_reports', async () => (await reports()).map((r) => ({
      id: r.id, report_ref: r.report_ref, fiu_profile_code: r.fiu_profile_code, type: r.type || null, status: r.status,
      due_at: r.clock?.due_at || null, fiu_reference: r.received?.fiu_reference || null, tm_case_id: r.tm_case_id || null, kyc_case_id: r.kyc_case_id || null,
    })));
  }
  if (want('fiu_artefacts')) {
    run('fiu_artefacts', async () => (fiuAllowed
      ? (await E.FiuArtefact.filter({ tenant_id: tenantId, client_id: cid }, '-created_date', 50).then(asList)).map((a) => ({ id: a.id, fiu_report_id: a.fiu_report_id, kind: a.kind, file_url: a.file_url, file_name: a.file_name, filed_at: a.filed_at || null }))
      : []));
  }
  if (want('decisions')) run('decisions', async () => (await decisions()).map((d) => ({ id: d.id, subject_type: d.subject_type, subject_id: d.subject_id, decision_type: d.decision_type, outcome: d.outcome, rationale: d.rationale, decided_by_user_id: d.decided_by_user_id, decided_at: d.decided_at || null })));
  if (want('risk_history')) run('risk_history', async () => (await scores()).slice(0, 12).map((s) => ({ at: s.computed_at, score: s.score, band: s.band })));
  if (want('profiles')) run('profiles', async () => (await profiles()).map((p) => ({ id: p.id, version: p.version, status: p.status, approved_at: p.approved_at || null, valid_until: p.valid_until || null })));
  if (want('coverage')) {
    run('coverage', async () => {
      const rows = await E.CoverageDay.filter({ tenant_id: tenantId, client_id: cid, date: { $gte: since30 } }, undefined, 1000).then(asList);
      const received = rows.filter((r) => RECEIVED_STATES.includes(r.state)).length;
      const missing = rows.filter((r) => r.state === 'missing').length;
      return { days: 30, expected: rows.filter((r) => r.expected !== false).length, received, missing };
    });
  }
  if (want('edr_triggers')) run('edr_triggers', async () => (await triggers()).filter((t) => t.status === 'proposed').map((t) => ({ id: t.id, trigger_type: t.trigger_type, source_ref: t.source_ref || null, created_date: t.created_date })));
  if (timeline) {
    run('timeline', async () => {
      const [c, p, a, tc, r, d, t, s] = await Promise.all([cases(), profiles(), alerts(), tmCases(), reports(), decisions(), triggers(), scores()]);
      return buildFileTimeline({ cases: c, profiles: p, alerts: a, tmCases: tc, reports: r, decisions: d, triggers: t, scores: s, cid });
    });
  }
  await Promise.all(jobs);
  return out;
}

// ---------------------------------------------------------------- Case TM context

const EVIDENCE_ORDER = { risk: 0, gap: 1, unclear: 2, ok: 3 };
const CLOSED_ALERT = ['closed_false_positive', 'closed_no_action', 'reported'];

/**
 * "Monitoring since last review": what happened in TM for this client since the last approved KYC decision
 * (else the last 12 months). Read-only; FIU counts only for roles allowed to read FIU reports.
 */
export async function buildReviewPeriod(base44, { tenantId, tenant, client, kycCase, fiuAllowed }) {
  const E = base44.asServiceRole.entities;
  const cid = client.id;
  const cur = tenant.tm_reporting_currency || 'USD';
  const lastApproval = asList(await E.Decision.filter({ tenant_id: tenantId, client_id: cid, decision_type: 'kyc_approval' }, '-decided_at', 5))
    .find((d) => d.subject_id !== kycCase.id && (d.decided_at || d.created_date));
  const fromIso = lastApproval?.decided_at || lastApproval?.created_date || new Date(Date.now() - 365 * DAY_MS).toISOString();
  const from = fromIso.slice(0, 10);
  const months = Math.max(1, (Date.now() - new Date(fromIso).getTime()) / (30.4 * DAY_MS));

  const [txns, priorTxns, alerts, tmCases, profile, scores, coverage, reports] = await Promise.all([
    fetchAll((cursor) => E.Transaction.filter({ tenant_id: tenantId, client_id: cid, executed_at: { $gte: fromIso } }, { limit: 1000, cursor }), 10),
    E.Transaction.filter({ tenant_id: tenantId, client_id: cid, executed_at: { $lt: fromIso } }, '-executed_at', 500).then(asList),
    E.TmAlert.filter({ tenant_id: tenantId, client_id: cid, created_date: { $gte: fromIso } }, '-created_date', 200).then(asList),
    E.TmCase.filter({ tenant_id: tenantId, primary_client_id: cid, created_date: { $gte: fromIso } }, '-created_date', 50).then(asList),
    E.ExpectedProfile.filter({ tenant_id: tenantId, client_id: cid, status: 'approved' }, '-version', 1).then((r) => asList(r)[0] || null),
    E.CustomerRiskScore.filter({ tenant_id: tenantId, client_id: cid }, '-computed_at', 200).then(asList),
    E.CoverageDay.filter({ tenant_id: tenantId, client_id: cid, date: { $gte: from }, state: 'missing' }, undefined, 1000).then(asList),
    fiuAllowed ? E.FiuReport.filter({ tenant_id: tenantId, client_id: cid, created_date: { $gte: fromIso } }, '-created_date', 50).then(asList) : Promise.resolve([]),
  ]);

  const sum = summariseTxns(txns, { client, reportingCurrency: cur });
  const perMonth = { inbound: sum.inbound / months, inboundCount: sum.inboundCount / months, outbound: sum.outbound / months, foreignOut: sum.foreignOut / months, cash: sum.cash / months, countries: sum.countries };
  const limits = profile ? await profileLimits(base44, tenantId, profile, cur) : null;
  const vs = limits ? compareToProfile(perMonth, limits, profile.allowed_countries, cur) : null;

  const priorCountries = new Set(countableTxns(priorTxns).map((t) => String(t.counterparty_country || '').toUpperCase()).filter(Boolean));
  const priorCps = new Set(priorTxns.map((t) => t.counterparty_id || t.counterparty_name).filter(Boolean));
  const newCountries = sum.countries.filter((c) => !priorCountries.has(c));
  const newCounterparties = uniq(countableTxns(txns).map((t) => t.counterparty_id || t.counterparty_name).filter((k) => !priorCps.has(k)));

  const startScore = [...scores].reverse().find((s) => (s.computed_at || '') <= fromIso) || scores[scores.length - 1] || null;
  const nowScore = scores[0] || null;
  const round = (v) => (v == null ? null : Math.round(v));

  return {
    from: fromIso, basis: lastApproval ? 'last_kyc_approval' : 'last_12_months', currency: cur,
    transactions: sum.txnCount, unconverted: sum.unconverted,
    per_month: { inbound: round(perMonth.inbound), inbound_count: Math.round(perMonth.inboundCount * 10) / 10, outbound: round(perMonth.outbound), foreign_out: round(perMonth.foreignOut), cash: round(perMonth.cash) },
    profile: profile ? {
      id: profile.id, version: profile.version,
      limits: limits ? { inbound: round(limits.inbound), inbound_count: limits.inboundCount, outbound: round(limits.outbound), foreign_out: round(limits.foreignOut), cash: round(limits.cash) } : null,
      breaches: (vs?.breaches || []).map((b) => b.reason), outside_countries: vs?.newCountries || [],
    } : null,
    alerts: { total: alerts.length, open: alerts.filter((a) => !CLOSED_ALERT.includes(a.status)).length, reported: alerts.filter((a) => a.status === 'reported').length },
    tm_cases: tmCases.map((c) => ({ id: c.id, case_ref: c.case_ref, status: c.status })),
    fiu_reports: fiuAllowed ? reports.length : null,
    risk: { from: startScore ? { score: round(startScore.score), band: startScore.band } : null, now: nowScore ? { score: round(nowScore.score), band: nowScore.band } : null },
    coverage_missing_days: coverage.length,
    new_countries: newCountries, new_counterparties: newCounterparties.length,
  };
}

export async function buildCaseTmContext(base44, { tenantId, tenant, kycCase, role }) {
  const E = base44.asServiceRole.entities;
  const cid = kycCase.client_id;
  const fiuAllowed = FIU_READ_ROLES.includes(role);

  let tmCase = null;
  if (kycCase.tm_case_id) tmCase = asList(await E.TmCase.filter({ tenant_id: tenantId, id: kycCase.tm_case_id }, undefined, 1))[0] || null;
  if (!tmCase) tmCase = asList(await E.TmCase.filter({ tenant_id: tenantId, kyc_edr_case_id: kycCase.id }, '-created_date', 1))[0] || null;

  const fieldIds = uniq(kycCase.tm_alert_ids || []).slice(0, 100);
  // Every case gets the review-period view when TM data exists for the client; the TM-case parts stay optional.
  const periodClient = asList(await E.Client.filter({ tenant_id: tenantId, id: cid }, undefined, 1))[0] || null;
  const period = periodClient ? await buildReviewPeriod(base44, { tenantId, tenant, client: periodClient, kycCase, fiuAllowed }).catch((e) => { console.warn('buildReviewPeriod failed', e?.message); return null; }) : null;
  const periodHasData = !!period && (period.transactions > 0 || period.alerts.total > 0 || !!period.profile || period.tm_cases.length > 0);
  if (!tmCase && !fieldIds.length) {
    if (!periodHasData) return { has_context: false };
    return {
      has_context: true, tm_case: null, alerts: [], alerts_from_case_field: [],
      risk: { at_open: kycCase.tm_context?.score ?? null, now: periodClient?.customer_risk_score ?? null, band: periodClient?.customer_risk_band || null },
      profile: null, fiu_reports: [], tipping_off_locked: false, period,
      trigger: kycCase.tm_context?.trigger || null,
    };
  }

  const caseIds = uniq(tmCase?.alert_ids || []).slice(0, 100);
  const loadAlerts = (ids) => (ids.length ? E.TmAlert.filter({ tenant_id: tenantId, id: { $in: ids } }, undefined, 100).then(asList) : Promise.resolve([]));
  const slim = (a) => ({ id: a.id, title: a.title, score: a.score ?? null, status: a.status, due_at: a.due_at || null });
  const cur = tenant.tm_reporting_currency || 'USD';

  const [client, caseAlerts, fieldAlerts, profile, deviation, reports, locks] = await Promise.all([
    E.Client.filter({ tenant_id: tenantId, id: cid }, undefined, 1).then((r) => asList(r)[0] || null),
    loadAlerts(caseIds),
    loadAlerts(fieldIds),
    E.ExpectedProfile.filter({ tenant_id: tenantId, client_id: cid, status: 'approved' }, '-version', 1).then((r) => asList(r)[0] || null),
    E.TmAlert.filter({ tenant_id: tenantId, client_id: cid, source: 'profile_deviation' }, '-created_date', 1).then((r) => asList(r)[0] || null),
    fiuAllowed
      ? Promise.all([
          tmCase ? E.FiuReport.filter({ tenant_id: tenantId, tm_case_id: tmCase.id }, '-created_date', 20).then(asList) : [],
          E.FiuReport.filter({ tenant_id: tenantId, kyc_case_id: kycCase.id }, '-created_date', 20).then(asList),
        ]).then(([a, b]) => [...new Map([...a, ...b].map((r) => [r.id, r])).values()])
      : Promise.resolve([]),
    E.TippingOffLock.filter({ tenant_id: tenantId, client_id: cid, locked: true }, undefined, 5).then(asList),
  ]);

  const limits = profile ? await profileLimits(base44, tenantId, profile, cur) : null;
  const evidence = [...(tmCase?.evidence || [])]
    .sort((a, b) => (EVIDENCE_ORDER[a.kind] ?? 9) - (EVIDENCE_ORDER[b.kind] ?? 9))
    .slice(0, 5)
    .map((e) => ({ id: e.id, kind: e.kind, text: e.text, accepted: e.accepted ?? null }));

  return {
    has_context: true,
    tm_case: tmCase ? {
      id: tmCase.id, case_ref: tmCase.case_ref, status: tmCase.status,
      assigned_to_user_id: tmCase.assigned_to_user_id || null, four_eyes_user_id: tmCase.four_eyes_user_id || null,
      due_at: tmCase.due_at || null, evidence,
    } : null,
    alerts: caseAlerts.map(slim),
    alerts_from_case_field: fieldAlerts.map(slim),
    risk: { at_open: kycCase.tm_context?.score ?? null, now: client?.customer_risk_score ?? null, band: client?.customer_risk_band || null },
    profile: profile ? {
      version: profile.version,
      inbound_max_month: limits?.inbound ?? null,
      breach_summary: deviation ? [deviation.title, ...(deviation.ai_reasons || []).slice(0, 2)].filter(Boolean).join(' · ') : null,
    } : null,
    fiu_reports: reports.map((r) => ({ id: r.id, report_ref: r.report_ref, status: r.status })),
    tipping_off_locked: locks.some((l) => l.locked && !l.unlocked_at),
    period: periodHasData ? period : null,
    trigger: kycCase.tm_context?.trigger || null,
  };
}