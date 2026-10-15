import React from 'react';
import { Button } from '@/components/ui/button';
import { format } from 'date-fns';

function describe(h, related) {
  const name = (id) => related[id]?.display_name || id;
  if (h.type === 'merge') return `Merged into ${name(h.into)}`;
  if (h.type === 'absorbed') return `Absorbed ${name(h.counterparty_id)} (${h.transaction_count ?? 0} transactions)`;
  if (h.type === 'released') return `Released ${name(h.counterparty_id)}`;
  return `Unmerged from ${name(h.from)}`; // 'unmerged' (and the older 'unmerge')
}

/** Merge history, newest first, with Unmerge on entries that are still in effect. */
export default function MergeHistory({ cp, related, canWork, onUnmerge }) {
  const history = cp.merge_history || [];
  if (history.length === 0) return <p className="text-xs text-muted-foreground">No merges.</p>;
  const lastMergeIdx = history.map((h) => h.type).lastIndexOf('merge');
  const canUndo = (h, i) => {
    if (!canWork) return null;
    if (h.type === 'merge' && i === lastMergeIdx && cp.merged_into === h.into) return cp.id;
    if (h.type === 'absorbed' && related[h.counterparty_id]?.merged_into === cp.id) return h.counterparty_id;
    return null;
  };
  return (
    <ul className="divide-y divide-border rounded-lg border border-border">
      {history.map((h, i) => ({ h, i })).reverse().map(({ h, i }) => {
        const undo = canUndo(h, i);
        return (
          <li key={i} className="flex items-start justify-between gap-3 px-3 py-2 text-xs">
            <div className="min-w-0">
              <div>{describe(h, related)}</div>
              <div className="text-muted-foreground">{h.at ? format(new Date(h.at), 'd MMM yyyy HH:mm') : ''}{h.reason ? ` · ${h.reason}` : ''}</div>
            </div>
            {undo && <Button size="sm" variant="outline" className="h-6 flex-shrink-0 px-2 text-[11px]" onClick={() => onUnmerge(undo)}>Unmerge</Button>}
          </li>
        );
      })}
    </ul>
  );
}