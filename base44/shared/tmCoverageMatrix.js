// Risk coverage matrix (Covered / Partial / Gap / No data per scenario), computed on the server so exports,
// MI and the Quality page use the same numbers. Same rules as src/lib/tmQuality.js (keep them in step).

export const TEST_FRESH_DAYS = 180;
export const AVAILABLE_DATA = new Set([
  'transactions', 'transaction', 'counterparty', 'counterparties', 'accounts', 'bank_accounts', 'profile', 'expected_profile',
  'statements', 'screening', 'kyc', 'customer', 'country', 'amount', 'cash', 'payments', 'alerts', 'fx',
]);
const ageDays = (iso) => (iso ? (Date.now() - new Date(iso).getTime()) / 86400000 : Infinity);

/** Newest backtest (via the scenario's rules) or completed sample: { at, label, passing } or null. */
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
      const bad = s.sample_type === 'ai_shadow' ? (s.metrics?.missed || 0) + (s.metrics?.wrongly_closed || 0) : s.findings_count || 0;
      cands.push({ at: s.completed_at || s.created_date, label: `${s.sample_type === 'ai_shadow' ? 'AI shadow' : 'Sample'} · ${s.findings_count ?? 0} finding(s)`, passing: bad === 0 });
    }
  }
  return cands.sort((a, b) => new Date(b.at) - new Date(a.at))[0] || null;
}

export function coverageStatus(scenario, rules, test) {
  if ((scenario.required_data || []).some((d) => !AVAILABLE_DATA.has(String(d).toLowerCase()))) return 'No data';
  const live = rules.filter((r) => ['active', 'test'].includes(r.mode));
  if (!live.length) return 'Gap';
  const fresh = test && test.passing && ageDays(test.at) <= TEST_FRESH_DAYS;
  return live.some((r) => r.mode === 'active') && fresh ? 'Covered' : 'Partial';
}

/** Flat matrix rows plus counts per status. usersById: Map of user id -> user. */
export function buildCoverageMatrix({ risks, scenarios, rules, backtests, samples, usersById = new Map() }) {
  const risksById = new Map(risks.map((r) => [r.id, r]));
  const rows = scenarios.map((s) => {
    const sr = rules.filter((r) => r.scenario_id === s.id && r.mode !== 'retired');
    const test = latestTest(s, new Set(sr.map((r) => r.id)), backtests, samples);
    const rule = sr.find((r) => r.mode === 'active') || sr.find((r) => r.mode === 'test') || sr[0];
    const risk = risksById.get(s.risk_id);
    const owner = usersById.get(rule?.owner_user_id || risk?.owner_user_id);
    return {
      scenario_id: s.id, scenario_code: s.code, scenario_name: s.name, jurisdiction: s.jurisdiction || 'ALL', indicator_type: s.indicator_type || null,
      risk_code: risk?.code || null, risk_name: risk?.name || null,
      status: coverageStatus(s, sr, test),
      rule_id: rule?.id || null, rule_name: rule?.name || null, rule_mode: rule?.mode || null,
      owner: owner?.full_name || owner?.email || '', review_date: rule?.review_date || '',
      last_test_at: test?.at || null, last_test_label: test?.label || null, last_test_passing: test ? !!test.passing : null,
    };
  });
  const counts = { Covered: 0, Partial: 0, Gap: 0, 'No data': 0 };
  for (const r of rows) counts[r.status] = (counts[r.status] || 0) + 1;
  return { rows, counts };
}
