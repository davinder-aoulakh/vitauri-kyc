// Helpers for the TM rules page (/tm/rules).
export const MODE_LABEL = { draft: 'Draft', test: 'Test', active: 'Active', disabled: 'Disabled', retired: 'Retired', unmanaged: 'Unmanaged in Didit' };
export const MODE_TONE = {
  draft: 'bg-secondary text-muted-foreground border-border',
  test: 'bg-sky-50 text-sky-700 border-sky-200',
  active: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  disabled: 'bg-amber-50 text-amber-700 border-amber-200',
  retired: 'bg-secondary text-muted-foreground border-border',
  unmanaged: 'bg-orange-50 text-orange-700 border-orange-200',
};
export const SYNC_LABEL = { not_synced: 'Not synced', synced: 'Synced', failed: 'Sync failed', drift: 'Drift' };
export const SYNC_TONE = {
  not_synced: 'bg-secondary text-muted-foreground border-border',
  synced: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  failed: 'bg-red-50 text-red-700 border-red-200',
  drift: 'bg-orange-50 text-orange-700 border-orange-200',
};
export const APPROVAL_LABEL = { not_requested: 'Not requested', requested: 'Awaiting approval', approved: 'Approved', rejected: 'Sent back' };
export const APPROVAL_TONE = {
  not_requested: 'bg-secondary text-muted-foreground border-border',
  requested: 'bg-purple-50 text-purple-700 border-purple-200',
  approved: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  rejected: 'bg-red-50 text-red-700 border-red-200',
};

export const lineageKey = (r) => r.lineage_id || r.id;

/** Groups rule rows into lineages (every version of one rule). Returns [{ key, latest, versions (newest first) }] newest lineage first. */
export function groupLineages(rules) {
  const map = new Map();
  for (const r of rules) {
    const k = lineageKey(r);
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(r);
  }
  return [...map.entries()]
    .map(([key, rows]) => {
      const versions = [...rows].sort((a, b) => (b.version || 1) - (a.version || 1));
      return { key, latest: versions[0], versions };
    })
    .sort((a, b) => new Date(b.latest.created_date || 0) - new Date(a.latest.created_date || 0));
}

export const prettyJson = (d) => JSON.stringify(d || {}, null, 2);
export const userName = (u) => u?.full_name || u?.name || u?.email || '';
export const isRetired = (r) => r?.mode === 'retired';

/** Why the rule cannot yet be sent for approval ([] when ready). Mirrors the server checks. */
export function approvalGaps(rule, backtest) {
  const gaps = [];
  if (!rule.scenario_id) gaps.push('a linked scenario');
  if (!rule.owner_user_id) gaps.push('an owner');
  if (!rule.review_date) gaps.push('a review date');
  if (!rule.backtest_id || !backtest) gaps.push('a backtest on this version');
  return gaps;
}

export const WINDOWS = [
  { days: 30, label: 'Last 30 days' },
  { days: 60, label: 'Last 60 days' },
  { days: 90, label: 'Last 90 days' },
];