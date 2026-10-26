import React, { useMemo } from 'react';
import { cn } from '@/lib/utils';
import { auditChange } from '@/lib/diditReadable';

/** An audit event's before/after as a field-by-field table (changed fields highlighted). */
export default function ChangeDiff({ before, after }) {
  const rows = useMemo(() => auditChange(before, after), [before, after]);
  if (!rows.length) return <p className="text-xs text-muted-foreground">No field details recorded.</p>;
  const hasBefore = rows.some((r) => r.before);
  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <table className="w-full text-xs">
        <thead className="bg-muted/40 text-left text-muted-foreground">
          <tr>
            <th className="px-2 py-1.5 font-medium">Field</th>
            {hasBefore && <th className="px-2 py-1.5 font-medium">Before</th>}
            <th className="px-2 py-1.5 font-medium">{hasBefore ? 'After' : 'Value'}</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {rows.map((r) => (
            <tr key={r.label} className={cn(r.changed && hasBefore && 'bg-amber-50/50 dark:bg-amber-500/10')}>
              <td className="px-2 py-1.5 text-muted-foreground">{r.label}</td>
              {hasBefore && <td className={cn('px-2 py-1.5 break-words', r.changed && 'line-through text-muted-foreground')}>{r.before || '—'}</td>}
              <td className="px-2 py-1.5 font-medium break-words">{r.after || '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
