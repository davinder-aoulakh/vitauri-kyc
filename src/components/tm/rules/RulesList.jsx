import React from 'react';
import { format } from 'date-fns';
import { ModeBadge, SyncBadge } from '@/components/tm/rules/RuleBadges';
import { userName } from '@/lib/tmRules';
import { cn } from '@/lib/utils';

export default function RulesList({ lineages, scenariosById, usersById, selectedId, onSelect }) {
  return (
    <div className="bg-card border border-border rounded-xl overflow-x-auto mb-5">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-[11px] uppercase tracking-wider text-muted-foreground border-b border-border">
            {['Rule', 'Scenario', 'Version', 'Mode', 'Didit sync', 'Owner', 'Review date'].map((h) => <th key={h} className="px-3 py-2.5 font-semibold">{h}</th>)}
          </tr>
        </thead>
        <tbody>
          {lineages.map(({ key, latest: r }) => (
            <tr key={key} onClick={() => onSelect(r.id)} className={cn('border-b border-border last:border-0 cursor-pointer hover:bg-secondary/60', selectedId === r.id && 'bg-accent')}>
              <td className="px-3 py-2.5 font-medium">{r.name}</td>
              <td className="px-3 py-2.5 text-muted-foreground">{scenariosById.get(r.scenario_id)?.code || '—'}</td>
              <td className="px-3 py-2.5 tabular-nums">v{r.version || 1}</td>
              <td className="px-3 py-2.5"><ModeBadge mode={r.mode} /></td>
              <td className="px-3 py-2.5"><SyncBadge rule={r} /></td>
              <td className="px-3 py-2.5 text-muted-foreground">{userName(usersById.get(r.owner_user_id)) || '—'}</td>
              <td className="px-3 py-2.5 text-muted-foreground tabular-nums">{r.review_date ? format(new Date(r.review_date), 'dd MMM yyyy') : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}