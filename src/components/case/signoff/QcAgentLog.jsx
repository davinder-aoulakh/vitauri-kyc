import React from 'react';
import { format } from 'date-fns';
import { cn } from '@/lib/utils';

const RESULT = { passed: 'text-emerald-700', failed: 'text-red-700', paused: 'text-amber-700', running: 'text-blue-700', error: 'text-red-700' };
const fmt = (d) => { try { return d ? format(new Date(d), 'd MMM HH:mm:ss') : '—'; } catch { return '—'; } };

/** Agent activity log: one line per QC round with checker, model, rule set, duration and counts. */
export default function QcAgentLog({ history = [], actions = [] }) {
  if (!history.length) return null;
  return (
    <details className="rounded-xl border border-border bg-card p-3 text-xs">
      <summary className="cursor-pointer text-sm font-semibold">Agent activity log</summary>
      <ol className="mt-2 space-y-2">
        {[...history].reverse().map((r) => {
          const secs = r.finished_at && r.started_at ? Math.round((new Date(r.finished_at) - new Date(r.started_at)) / 1000) : null;
          return (
            <li key={r.id} className="border-l-2 border-border pl-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">Round {r.round || 1}</span>
                <span className={cn('font-medium capitalize', RESULT[r.result])}>{r.result}</span>
                <span className="text-muted-foreground">{fmt(r.started_at)}{secs != null ? ` · ${secs}s` : ''}</span>
              </div>
              <div className="text-muted-foreground">
                Case Check (rules {r.ruleset || '—'}) · Report Check: {r.report_check || '—'}{r.model ? ` (${r.model})` : ''}
                {r.counts ? ` · ${r.counts.blocker || 0} blocker, ${r.counts.major || 0} major, ${r.counts.minor || 0} minor, ${r.counts.human || 0} for a person` : ''}
              </div>
            </li>
          );
        })}
        {actions.map((a) => (
          <li key={a.id} className="border-l-2 border-amber-300 pl-3">
            <div><span className="font-medium">{a.decided_by_name || 'Analyst'}</span> decided <span className="font-medium">{a.choice}</span> · {fmt(a.decided_at)}</div>
            <div className="text-muted-foreground">{a.question}</div>
          </li>
        ))}
      </ol>
    </details>
  );
}
