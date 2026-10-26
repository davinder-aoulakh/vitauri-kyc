import React, { useMemo } from 'react';
import { cn } from '@/lib/utils';
import { TONES } from '@/components/tm/kit/StatusPill';
import { transactionDecision } from '@/lib/diditReadable';

const TONE = { ok: TONES.success, bad: TONES.danger, warn: TONES.warning, neutral: TONES.neutral };

export function Rows({ rows }) {
  return (
    <dl className="divide-y divide-border/60">
      {rows.map((r, i) => (
        <div key={`${r.label}-${i}`} className="flex justify-between gap-3 py-1.5 text-xs">
          <dt className="text-muted-foreground">{r.label}</dt>
          <dd className={cn('max-w-[62%] text-right font-medium break-words', r.tone && r.tone !== 'neutral' && 'rounded-full border px-2 py-0.5 text-[11px]', r.tone && TONE[r.tone])}>{r.value}</dd>
        </div>
      ))}
    </dl>
  );
}

function RiskBar({ score }) {
  const n = Number(score);
  if (!Number.isFinite(n)) return null;
  const pct = Math.max(0, Math.min(100, n));
  const tone = pct >= 70 ? 'bg-destructive' : pct >= 40 ? 'bg-warning' : 'bg-success';
  return (
    <div className="flex items-center gap-2" aria-label={`Didit risk score ${n} out of 100`}>
      <div className="h-1.5 w-24 rounded-full bg-muted"><div className={cn('h-1.5 rounded-full', tone)} style={{ width: `${pct}%` }} /></div>
      <span className="text-xs font-semibold tabular-nums">{n}</span>
    </div>
  );
}

/** Didit's decision for a transaction, in readable sections (never raw JSON). */
export default function DiditDecisionView({ raw, transaction }) {
  const view = useMemo(() => transactionDecision(raw, transaction || {}), [raw, transaction]);
  if (!raw) return <p className="text-xs text-muted-foreground">No decision from Didit yet.</p>;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        {view.status && <span className={cn('rounded-full border px-2 py-0.5 text-xs font-medium', TONE[view.statusTone])}>{view.status}</span>}
        <RiskBar score={view.score} />
        {view.level && <span className="text-xs text-muted-foreground">Risk level: {view.level}</span>}
      </div>
      {view.sections.map((s) => (
        <section key={s.title} className="rounded-lg border border-border bg-muted/20 px-3 py-2">
          <h4 className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{s.title}</h4>
          <Rows rows={s.rows} />
        </section>
      ))}
    </div>
  );
}
