import React from 'react';
import { format } from 'date-fns';
import { ModeBadge, ApprovalBadge } from '@/components/tm/rules/RuleBadges';
import { cn } from '@/lib/utils';

export default function VersionHistory({ versions, selectedId, onSelect }) {
  return (
    <section className="bg-card border border-border rounded-xl p-4 mt-5">
      <h2 className="text-sm font-semibold mb-2">Version history</h2>
      <ul className="divide-y divide-border">
        {versions.map((v) => (
          <li key={v.id}>
            <button type="button" onClick={() => onSelect(v.id)} className={cn('w-full text-left py-2 flex items-center gap-3 text-sm hover:bg-secondary/60 px-2 rounded', selectedId === v.id && 'bg-accent')}>
              <span className="tabular-nums font-medium w-8">v{v.version || 1}</span>
              <ModeBadge mode={v.mode} />
              <ApprovalBadge status={v.approval_status} />
              <span className="flex-1 truncate text-muted-foreground">{v.change_note || '—'}</span>
              <span className="text-xs text-muted-foreground tabular-nums">{v.created_date ? format(new Date(v.created_date), 'dd MMM yyyy') : ''}</span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}