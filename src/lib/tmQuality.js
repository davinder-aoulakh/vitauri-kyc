// Helpers for the TM quality page (/tm/quality).
import { format } from 'date-fns';

export const PERIODS = [
  { days: 30, label: 'Last 30 days' },
  { days: 90, label: 'Last 90 days' },
  { days: 180, label: 'Last 180 days' },
  { days: 365, label: 'Last 12 months' },
];
export const RELEASE_ROLES = ['Compliance Officer', 'Director']; // mirrors scenarioRelease
export const TEST_FRESH_DAYS = 180;
export const DEFAULT_MAX_WRONGLY_CLOSED_PCT = 2;

// Data sources the platform can supply today. A scenario that needs anything else is "No data".
export const AVAILABLE_DATA = new Set([
  'transactions', 'transaction', 'counterparty', 'counterparties', 'accounts', 'bank_accounts', 'profile', 'expected_profile',
  'statements', 'screening', 'kyc', 'customer', 'country', 'amount', 'cash', 'payments', 'alerts', 'fx',
]);

export const isoDate = (d) => format(d, 'yyyy-MM-dd');
export function periodRange(days) {
  const to = new Date();
  return { from: isoDate(new Date(to.getTime() - days * 86400000)), to: isoDate(to) };
}
export const inPeriod = (iso, from, to) => !!iso && iso.slice(0, 10) >= from && iso.slice(0, 10) <= to;
export const ageDays = (iso) => (iso ? (Date.now() - new Date(iso).getTime()) / 86400000 : Infinity);
export const shortDate = (iso) => (iso ? format(new Date(iso), 'dd MMM yyyy') : '—');

/** Latest test of a scenario: its newest backtest (via its rules) or completed sample. Returns { at, label, passing } or null. */
export function latestTest(scenario, ruleIds, backtests, samples) {
  const cands = [];
  for (const b of backtests) {
    if (ruleIds.has(b.rule_id)) {
      const known = b.known_cases_total > 0 && b.known_cases_found != null;
      cands.push({ at: b.created_date, label: `Backtest · ${b.hits_txn ?? 0} hits${known ? ` · ${b.known_cases_found}/${b.known_cases_total} known cases` : ''}`, passing: !known || b.known_cases_found >= b.known_cases_total });
    }
  }
  for (const s of samples) {
    if (s.scenario_id === scenario.id && s.status === 'completed') {
      cands.push({ at: s.completed_at || s.created_date, label: `${s.sample_type === 'ai_shadow' ? 'AI shadow' : 'Sample'} · ${s.findings_count ?? 0} finding(s)`, passing: (s.sample_type === 'ai_shadow' ? (s.metrics?.missed || 0) + (s.metrics?.wrongly_closed || 0) : s.findings_count || 0) === 0 });
    }
  }
  return cands.sort((a, b) => new Date(b.at) - new Date(a.at))[0] || null;
}

/** Covered / Partial / Gap / No data for one scenario. */
export function coverageStatus(scenario, rules, test) {
  if ((scenario.required_data || []).some((d) => !AVAILABLE_DATA.has(String(d).toLowerCase()))) return 'No data';
  const live = rules.filter((r) => ['active', 'test'].includes(r.mode));
  if (!live.length) return 'Gap';
  const fresh = test && test.passing && ageDays(test.at) <= TEST_FRESH_DAYS;
  return live.some((r) => r.mode === 'active') && fresh ? 'Covered' : 'Partial';
}

export function buildMatrix({ risks, scenarios, rules, backtests, samples, usersById }) {
  const risksById = new Map(risks.map((r) => [r.id, r]));
  return scenarios.map((s) => {
    const sr = rules.filter((r) => r.scenario_id === s.id && r.mode !== 'retired');
    const test = latestTest(s, new Set(sr.map((r) => r.id)), backtests, samples);
    const rule = sr.find((r) => r.mode === 'active') || sr.find((r) => r.mode === 'test') || sr[0];
    const risk = risksById.get(s.risk_id);
    const ownerId = rule?.owner_user_id || risk?.owner_user_id;
    return {
      scenario: s, risk, test, status: coverageStatus(s, sr, test), rule,
      owner: usersById.get(ownerId)?.full_name || usersById.get(ownerId)?.name || usersById.get(ownerId)?.email || '',
      reviewDate: rule?.review_date || '',
    };
  });
}

/** Latest completed ai_shadow sample per scenario id. */
export function latestShadowByScenario(samples) {
  const out = new Map();
  for (const s of [...samples].sort((a, b) => new Date(b.completed_at || b.created_date) - new Date(a.completed_at || a.created_date))) {
    if (s.sample_type === 'ai_shadow' && s.status === 'completed' && s.scenario_id && !out.has(s.scenario_id)) out.set(s.scenario_id, s);
  }
  return out;
}

/** Client-side mirror of the server rule, only to explain why a toggle is unavailable. The server decides. */
export function releaseEligibility(sample, maxPct = DEFAULT_MAX_WRONGLY_CLOSED_PCT) {
  if (!sample || ageDays(sample.completed_at) > 90) return { ok: false, reason: 'Needs an AI shadow sample from the last 90 days' };
  const m = sample.metrics || {};
  if (!m.close_proposals) return { ok: false, reason: 'No AI close proposals in the sample' };
  if (m.missed > 0) return { ok: false, reason: `${m.missed} missed in the latest sample` };
  const pct = (m.wrongly_closed / m.close_proposals) * 100;
  if (pct > maxPct) return { ok: false, reason: `Wrongly closed ${pct.toFixed(1)}% is above ${maxPct}%` };
  return { ok: true, reason: '' };
}

const csvCell = (v) => {
  const s = v == null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
export function toCsv(sections) {
  return Object.entries(sections).map(([name, rows]) => {
    const cols = [...new Set(rows.flatMap((r) => Object.keys(r)))];
    return [`# ${name}`, cols.join(','), ...rows.map((r) => cols.map((c) => csvCell(r[c])).join(','))].join('\n');
  }).join('\n\n');
}

export function download(filename, text, mime) {
  const url = URL.createObjectURL(new Blob([text], { type: mime }));
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

export const OUTCOME_LABEL = { ok: 'OK', missed_signal: 'Missed signal', wrongly_closed: 'Wrongly closed', citation_error: 'Citation error', pending: 'Pending' };
export const SAMPLE_LABEL = { below_the_line: 'Below the line', file_review: 'File review', ai_shadow: 'AI shadow' };