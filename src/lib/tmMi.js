// Helpers for the TM tab of the MI dashboard.
import { format, startOfMonth, endOfMonth, startOfWeek, subMonths } from 'date-fns';
import { base44 } from '@/api/base44Client';

export const OPEN_ALERT = ['new', 'triaged', 'in_review'];
export const FINISHED_ALERT = ['closed_false_positive', 'closed_no_action', 'escalated', 'reported'];
export const monthOptions = () => Array.from({ length: 12 }, (_, i) => { const d = subMonths(new Date(), i); return { value: format(d, 'yyyy-MM'), label: format(d, 'MMMM yyyy') }; });
export const monthRange = (ym) => { const d = new Date(`${ym}-01T12:00:00`); return { from: startOfMonth(d), to: endOfMonth(d) }; };
export const weekKey = (iso) => format(startOfWeek(new Date(iso), { weekStartsOn: 1 }), 'dd MMM');

/** Pages through a tenant-scoped filter. Cursor loop; stops at `cap` rows and reports truncation. */
export async function fetchAllRows(entity, query, sort = '-created_date', cap = 5000) {
  const rows = [];
  let cursor;
  while (rows.length < cap) {
    const page = await entity.filter(query, { sort, limit: 1000, ...(cursor ? { cursor } : {}) });
    rows.push(...(page.items || []));
    if (!page.has_more || !page.next_cursor) return { rows, truncated: false };
    cursor = page.next_cursor;
  }
  return { rows, truncated: true };
}

export async function loadMonth(tenantId, ym) {
  const { from, to } = monthRange(ym);
  const range = { $gte: from.toISOString(), $lte: to.toISOString() };
  const [alerts, reports, coverage, scenarios, fxMissing, cases, openAlerts] = await Promise.all([
    fetchAllRows(base44.entities.TmAlert, { tenant_id: tenantId, created_date: range }),
    fetchAllRows(base44.entities.FiuReport, { tenant_id: tenantId, created_date: range }),
    fetchAllRows(base44.entities.CoverageDay, { tenant_id: tenantId, date: { $gte: format(from, 'yyyy-MM-dd'), $lte: format(to, 'yyyy-MM-dd') }, expected: true }, 'date'),
    fetchAllRows(base44.entities.TmScenario, { tenant_id: tenantId }, 'code', 500),
    // Fiat transactions in the month without fx (excluded from reporting-currency totals).
    base44.entities.Transaction.count({ tenant_id: tenantId, currency_kind: 'fiat', executed_at: range, $or: [{ fx: { $exists: false } }, { fx: null }] }),
    fetchAllRows(base44.entities.TmCase, { tenant_id: tenantId, created_date: range }),
    // Backlog is "now", independent of the selected month.
    fetchAllRows(base44.entities.TmAlert, { tenant_id: tenantId, status: { $in: OPEN_ALERT } }, 'created_date'),
  ]);
  return {
    fxMissing: Number(fxMissing) || 0, alerts: alerts.rows, reports: reports.rows, coverage: coverage.rows, scenarios: scenarios.rows,
    cases: cases.rows, openAlerts: openAlerts.rows,
    truncated: alerts.truncated || reports.truncated || coverage.truncated || cases.truncated || openAlerts.truncated,
  };
}

const doneAt = (a) => a.updated_date;
export function computeKpis(alerts, reports) {
  const fp = alerts.filter((a) => a.status === 'closed_false_positive').length;
  const closed = alerts.filter((a) => ['closed_false_positive', 'closed_no_action'].includes(a.status)).length;
  const now = Date.now();
  const missed = alerts.filter((a) => a.due_at && (OPEN_ALERT.includes(a.status) ? new Date(a.due_at) < now : new Date(doneAt(a)) > new Date(a.due_at))).length;
  const timed = alerts.filter((a) => FINISHED_ALERT.includes(a.status) && a.discovered_at && doneAt(a));
  const avgH = timed.length ? timed.reduce((s, a) => s + Math.max(0, new Date(doneAt(a)) - new Date(a.discovered_at)), 0) / timed.length / 3600000 : null;
  return {
    alerts: alerts.length,
    fpRate: closed ? Math.round((fp / closed) * 1000) / 10 : null,
    missed,
    avgHours: avgH == null ? null : Math.round(avgH * 10) / 10,
    objective: reports.filter((r) => r.type === 'unusual_objective').length,
    subjective: reports.filter((r) => r.type === 'unusual_subjective').length,
  };
}

export function alertsByWeek(alerts, scenarios) {
  const code = new Map(scenarios.map((s) => [s.id, s.code]));
  const codes = new Set();
  const rows = new Map();
  alerts.forEach((a) => {
    const w = weekKey(a.created_date); const c = code.get(a.scenario_id) || 'Other';
    codes.add(c);
    const row = rows.get(w) || { week: w, _t: new Date(a.created_date) };
    row[c] = (row[c] || 0) + 1; rows.set(w, row);
  });
  return { data: [...rows.values()].sort((a, b) => a._t - b._t), codes: [...codes] };
}

export function coverageByWeek(days) {
  const rows = new Map();
  days.forEach((d) => {
    const w = weekKey(`${d.date}T12:00:00`);
    const r = rows.get(w) || { week: w, _t: new Date(d.date), ok: 0, total: 0 };
    r.total += 1; if (['received', 'processed', 'reviewed'].includes(d.state)) r.ok += 1;
    rows.set(w, r);
  });
  return [...rows.values()].sort((a, b) => a._t - b._t).map((r) => ({ week: r.week, coverage: Math.round((r.ok / r.total) * 100) }));
}

const median = (xs) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const days1 = (ms) => Math.round((ms / 86400000) * 10) / 10;

/** TM cases opened in the month: how many reached a CO decision and how long it took (days, median and p90). */
export function caseDecisionStats(cases) {
  const decided = cases.filter((c) => c.co_decided_at);
  const durations = decided.map((c) => Math.max(0, new Date(c.co_decided_at) - new Date(c.created_date)));
  const sorted = [...durations].sort((a, b) => a - b);
  const p90 = sorted.length ? sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.9) - 1)] : null;
  return {
    opened: cases.length, decided: decided.length,
    reported: decided.filter((c) => c.co_decision === 'report').length,
    medianDays: durations.length ? days1(median(durations)) : null,
    p90Days: p90 == null ? null : days1(p90),
  };
}

/** Alerts whose deadline passed before they were handled (or are still open past it), grouped by the week the deadline fell in. */
export function slaBreachesByWeek(alerts) {
  const now = Date.now();
  const rows = new Map();
  alerts.forEach((a) => {
    if (!a.due_at) return;
    const due = new Date(a.due_at);
    const open = OPEN_ALERT.includes(a.status);
    const breached = open ? due < now : new Date(doneAt(a)) > due;
    const w = weekKey(a.due_at);
    const r = rows.get(w) || { week: w, _t: due, due: 0, breached: 0 };
    r.due += 1; if (breached) r.breached += 1;
    rows.set(w, r);
  });
  return [...rows.values()].sort((a, b) => a._t - b._t).map(({ week, due, breached }) => ({ week, due, breached, pct: due ? Math.round((breached / due) * 100) : 0 }));
}

export const BACKLOG_BUCKETS = [['0–2 days', 2], ['3–7 days', 7], ['8–30 days', 30], ['Over 30 days', Infinity]];
/** Open alerts today by age since discovery (or creation). */
export function backlogAge(openAlerts) {
  const now = Date.now();
  const counts = BACKLOG_BUCKETS.map(([label]) => ({ label, count: 0 }));
  openAlerts.forEach((a) => {
    const age = (now - new Date(a.discovered_at || a.created_date)) / 86400000;
    const i = BACKLOG_BUCKETS.findIndex(([, max]) => age <= max);
    counts[i].count += 1;
  });
  const oldest = openAlerts.reduce((m, a) => Math.max(m, now - new Date(a.discovered_at || a.created_date)), 0);
  return { total: openAlerts.length, buckets: counts, oldestDays: openAlerts.length ? Math.floor(oldest / 86400000) : null };
}

/** False positives per scenario among alerts closed in the month, worst first. */
export function fpByScenario(alerts, scenarios) {
  const byId = new Map(scenarios.map((s) => [s.id, s]));
  const rows = new Map();
  alerts.forEach((a) => {
    if (!FINISHED_ALERT.includes(a.status)) return;
    const s = byId.get(a.scenario_id);
    const key = s?.code || 'Other';
    const r = rows.get(key) || { code: key, name: s?.name || 'No scenario', handled: 0, fp: 0 };
    r.handled += 1; if (a.status === 'closed_false_positive') r.fp += 1;
    rows.set(key, r);
  });
  return [...rows.values()].map((r) => ({ ...r, pct: r.handled ? Math.round((r.fp / r.handled) * 100) : 0 })).sort((a, b) => b.pct - a.pct || b.handled - a.handled);
}

/** Status pill for an FIU report: { label, tone }. */
export function reportPill(r) {
  if (r.status === 'in_review') return { label: '4-eyes review', tone: 'bg-blue-50 text-blue-700 border-blue-200' };
  if (r.status === 'generated') return { label: 'Generated · not yet submitted', tone: 'bg-amber-50 text-amber-700 border-amber-200' };
  if (['submitted', 'received', 'accepted'].includes(r.status)) {
    const ref = r.received?.fiu_reference;
    return ref ? { label: `Submitted · FIU ref ${ref}`, tone: 'bg-emerald-50 text-emerald-700 border-emerald-200' } : { label: 'Submitted · awaiting FIU ref', tone: 'bg-amber-50 text-amber-700 border-amber-200' };
  }
  return { label: String(r.status || '').replace(/_/g, ' '), tone: 'bg-secondary text-muted-foreground border-border' };
}

const cell = (v) => { const s = v == null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v); return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
const section = (name, rows) => [`# ${name}`, ...(rows.length ? [Object.keys(rows[0]).join(','), ...rows.map((r) => Object.values(r).map(cell).join(','))] : ['(no records)'])].join('\n');

/** Supervisor CSV: ALL tenant alerts, TM cases and FIU reports (not limited to the selected month). */
export async function buildSupervisorCsv(tenantId) {
  const [a, c, r] = await Promise.all([
    fetchAllRows(base44.entities.TmAlert, { tenant_id: tenantId }, '-created_date', 20000),
    fetchAllRows(base44.entities.TmCase, { tenant_id: tenantId }, '-created_date', 20000),
    fetchAllRows(base44.entities.FiuReport, { tenant_id: tenantId }, '-created_date', 20000),
  ]);
  const alerts = a.rows.map((x) => ({ id: x.id, title: x.title, status: x.status, indicator_type: x.indicator_type, priority: x.priority, ai_proposal: x.ai_proposal, tm_case_id: x.tm_case_id, executed_at: x.executed_at, received_at: x.received_at, discovered_at: x.discovered_at, due_at: x.due_at, created_at: x.created_date, updated_at: x.updated_date }));
  const cases = c.rows.map((x) => ({ id: x.id, case_ref: x.case_ref, title: x.title, status: x.status, phase: x.phase, escalated_to_co_at: x.escalated_to_co_at, co_decision: x.co_decision, co_decided_at: x.co_decided_at, due_at: x.due_at, created_at: x.created_date, updated_at: x.updated_date }));
  const reports = r.rows.map((x) => ({ id: x.id, report_ref: x.report_ref, fiu: x.fiu_profile_code, type: x.type, status: x.status, version: x.version, deadline: x.clock?.due_at, approved_at: x.approved_at, generated_at: x.generated?.at, submitted_at: x.submitted?.at, fiu_reference: x.received?.fiu_reference, received_at: x.received?.at, created_at: x.created_date, updated_at: x.updated_date }));
  const truncated = a.truncated || c.truncated || r.truncated;
  return { csv: [section('alerts', alerts), section('cases', cases), section('fiu_reports', reports)].join('\n\n'), truncated };
}

export function downloadText(filename, text, mime = 'text/csv') {
  const url = URL.createObjectURL(new Blob([text], { type: mime }));
  const a = document.createElement('a'); a.href = url; a.download = filename; a.click(); URL.revokeObjectURL(url);
}