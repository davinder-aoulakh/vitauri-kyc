import React from 'react';
import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

export default function ChecksPanel({ checks, report }) {
  const stored = report.approval?.checks;
  return (
    <section className="bg-card border border-border rounded-xl p-4">
      <h2 className="text-sm font-semibold mb-2">Checks before approval</h2>
      {checks.isLoading && <Loader2 className="w-4 h-4 animate-spin text-primary" />}
      {checks.data && (
        <ul className="space-y-2">
          {checks.data.map((c) => (
            <li key={c.key} className="text-sm flex gap-2">
              <span className={cn('font-bold', c.ok ? 'text-emerald-600' : 'text-red-600')} aria-label={c.ok ? 'Passed' : 'Failed'}>{c.ok ? '✓' : '✗'}</span>
              <div><div>{c.label}</div>{c.detail && <div className="text-xs text-muted-foreground">{c.detail}</div>}</div>
            </li>
          ))}
        </ul>
      )}
      {!checks.data && !checks.isLoading && stored?.length > 0 && <p className="text-xs text-muted-foreground">All {stored.length} checks passed at approval.</p>}
      {report.lateness_reason && <p className="mt-3 text-xs text-muted-foreground">Lateness reason: {report.lateness_reason}</p>}
    </section>
  );
}