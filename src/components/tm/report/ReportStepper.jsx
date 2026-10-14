import React from 'react';
import { buildSteps } from '@/lib/fiuReport';
import { cn } from '@/lib/utils';

const MARK = { done: '✓', current: '●', todo: '○' };

export default function ReportStepper({ report }) {
  return (
    <ol className="flex flex-wrap gap-x-5 gap-y-1.5 bg-card border border-border rounded-xl px-4 py-3 mb-5 text-sm">
      {buildSteps(report).map((s) => (
        <li key={s.key} className={cn('flex items-center gap-1.5', s.state === 'done' && 'text-emerald-700', s.state === 'current' && 'text-primary font-semibold', s.state === 'todo' && 'text-muted-foreground')}>
          <span aria-hidden>{MARK[s.state]}</span> {s.label}
        </li>
      ))}
    </ol>
  );
}