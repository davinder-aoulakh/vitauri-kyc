import React from 'react';
import { Button } from '@/components/ui/button';
import EmptyState from '@/components/shared/EmptyState';
import { cn } from '@/lib/utils';
import { SAMPLE_LABEL, shortDate } from '@/lib/tmQuality';
import { ClipboardCheck } from 'lucide-react';

export default function SamplesPanel({ samples, selectedId, onSelect, onStart }) {
  return (
    <section className="bg-card border border-border rounded-xl p-4">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
        <h2 className="text-sm font-semibold">Below-the-line and file review</h2>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={() => onStart('below_the_line')}>New below-the-line sample</Button>
          <Button size="sm" variant="outline" onClick={() => onStart('file_review')}>New file review</Button>
        </div>
      </div>
      {samples.length === 0 ? (
        <EmptyState icon={ClipboardCheck} title="No samples yet" description="Start a sample to have an independent reviewer check what the monitoring did not flag or closed." />
      ) : (
        <ul className="divide-y divide-border">
          {samples.map((s) => (
            <li key={s.id}>
              <button type="button" onClick={() => onSelect(s.id)} className={cn('w-full text-left px-2 py-2.5 rounded flex items-center gap-3 text-sm hover:bg-secondary/60', selectedId === s.id && 'bg-accent')}>
                <span className="font-medium w-32 shrink-0">{SAMPLE_LABEL[s.sample_type]}</span>
                <span className="text-xs text-muted-foreground flex-1">{s.period_from} to {s.period_to} · {s.sample_size} item(s)</span>
                <span className={cn('text-xs tabular-nums', s.status === 'completed' && (s.findings_count ? 'text-red-700' : 'text-emerald-700'))}>
                  {s.status === 'completed' ? `${s.findings_count || 0} finding(s)` : `${s.metrics?.pending ?? s.sample_size} to review`}
                </span>
                <span className="text-xs text-muted-foreground w-24 text-right">{shortDate(s.completed_at || s.created_date)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}