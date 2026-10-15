import React from 'react';

const Row = ({ label, value }) => (
  <div className="flex justify-between gap-3 text-xs"><span className="text-muted-foreground">{label}</span><span className="font-medium max-w-[60%] truncate text-right">{value}</span></div>
);

/** Read-only canonical data of a transaction (TM). Renders nothing when none of the fields exist. */
export default function CanonicalData({ transaction: t }) {
  const runs = Array.isArray(t.didit_rule_runs) ? t.didit_rule_runs : [];
  if (!t.dedupe_key && !t.fx && !t.coverage_date && runs.length === 0) return null;
  return (
    <div className="space-y-2">
      <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Canonical data</div>
      <div className="bg-muted/40 rounded-lg p-3 space-y-1">
        {t.dedupe_key && <Row label="Dedupe key" value={t.dedupe_key} />}
        {t.fx && <Row label="FX" value={t.fx.rate != null ? `${t.fx.rate} (${t.fx.rate_date || 'n/a'}) → ${t.fx.amount_reporting ?? '—'} ${t.fx.reporting_currency || ''}` : '—'} />}
        {t.coverage_date && <Row label="Coverage date" value={t.coverage_date} />}
        <Row label="Rule runs" value={runs.length} />
      </div>
      {runs.length > 0 && (
        <pre className="bg-muted/30 rounded-lg p-3 text-[11px] leading-relaxed overflow-x-auto max-h-40 whitespace-pre-wrap break-all">{JSON.stringify(runs, null, 2)}</pre>
      )}
    </div>
  );
}