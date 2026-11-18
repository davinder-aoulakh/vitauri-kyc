import React from 'react';
import { cn } from '@/lib/utils';

/** Classic | Conversation switch shown on the outreach tabs when the guided conversation is on for the tenant. */
export default function EngineSwitch({ value, onChange }) {
  return (
    <div className="mb-4 inline-flex rounded-lg border border-border bg-card p-0.5 text-xs" role="tablist" aria-label="Outreach type">
      {[['classic', 'Classic'], ['conversation', 'Guided conversation']].map(([k, l]) => (
        <button key={k} type="button" role="tab" aria-selected={value === k} onClick={() => onChange(k)}
          className={cn('rounded-md px-3 py-1.5 transition-colors', value === k ? 'bg-primary text-primary-foreground font-medium' : 'text-muted-foreground hover:text-foreground')}>
          {l}
        </button>
      ))}
    </div>
  );
}
