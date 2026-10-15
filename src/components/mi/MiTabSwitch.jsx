import React from 'react';
import { cn } from '@/lib/utils';

const TABS = [{ id: 'overview', label: 'Overview' }, { id: 'tm', label: 'Transaction monitoring' }];

/** Overview / Transaction monitoring switch for the MI dashboard. Only rendered when tm_core is on. */
export default function MiTabSwitch({ active, onChange }) {
  return (
    <div className="inline-flex gap-1 p-1 bg-card border border-border rounded-full" role="tablist">
      {TABS.map((t) => (
        <button key={t.id} role="tab" aria-selected={active === t.id} onClick={() => onChange(t.id)}
          className={cn('text-xs px-3 py-1.5 rounded-full transition-colors', active === t.id ? 'bg-primary text-white' : 'text-muted-foreground hover:text-foreground')}>
          {t.label}
        </button>
      ))}
    </div>
  );
}