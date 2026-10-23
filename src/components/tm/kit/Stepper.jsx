import React from 'react';
import { Check } from 'lucide-react';
import { cn } from '@/lib/utils';

/** Horizontal progress stepper. steps: [{ key, label, state: 'done'|'current'|'todo', hint? }]. Wraps on small screens. */
export default function Stepper({ steps, className }) {
  return (
    <ol className={cn('flex flex-wrap items-start gap-x-1 gap-y-3', className)} aria-label="Progress">
      {steps.map((s, i) => (
        <li key={s.key} className="flex min-w-[110px] flex-1 items-start gap-2" aria-current={s.state === 'current' ? 'step' : undefined}>
          <span className={cn(
            'mt-0.5 flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full border text-[11px] font-semibold',
            s.state === 'done' && 'border-emerald-600 bg-emerald-600 text-white',
            s.state === 'current' && 'border-primary bg-primary/10 text-primary ring-2 ring-primary/20',
            s.state === 'todo' && 'border-border bg-background text-muted-foreground',
          )}>
            {s.state === 'done' ? <Check className="h-3.5 w-3.5" aria-hidden /> : i + 1}
          </span>
          <span className="min-w-0">
            <span className={cn('block text-xs font-medium leading-tight', s.state === 'todo' ? 'text-muted-foreground' : 'text-foreground')}>{s.label}</span>
            {s.hint && <span className="block text-[11px] text-muted-foreground">{s.hint}</span>}
          </span>
          {i < steps.length - 1 && <span aria-hidden className={cn('mt-3 hidden h-px flex-1 sm:block', s.state === 'done' ? 'bg-emerald-600' : 'bg-border')} />}
        </li>
      ))}
    </ol>
  );
}
