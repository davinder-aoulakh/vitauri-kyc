import React from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { FileText, Plus } from 'lucide-react';

export default function StatementPicker({ uploads, selected, onToggle, period, onPeriod, onAdd, canEdit }) {
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h5 className="text-xs font-semibold">Statements</h5>
        {canEdit && (
          <Button size="sm" variant="outline" className="h-7 gap-1.5 text-xs" onClick={onAdd}>
            <Plus className="w-3 h-3" /> Add statement
          </Button>
        )}
      </div>

      {uploads.length === 0 ? (
        <p className="text-xs italic text-muted-foreground">No committed statements for this client yet.</p>
      ) : (
        <div className="max-h-40 space-y-1 overflow-y-auto rounded-lg border border-border bg-muted/20 p-2">
          {uploads.map((u) => (
            <label key={u.id} className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-xs hover:bg-muted/50">
              <input type="checkbox" className="accent-primary" checked={selected.includes(u.id)} onChange={() => onToggle(u.id)} disabled={!canEdit} />
              <FileText className="w-3.5 h-3.5 text-muted-foreground" />
              <span className="flex-1 truncate">{u.file_name}</span>
              <span className="text-muted-foreground">{u.period_from} to {u.period_to}</span>
            </label>
          ))}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="text-muted-foreground">Period</span>
        <Input type="date" className="h-8 w-36 text-xs" value={period.from} disabled={!canEdit} onChange={(e) => onPeriod({ ...period, from: e.target.value })} />
        <span className="text-muted-foreground">to</span>
        <Input type="date" className="h-8 w-36 text-xs" value={period.to} disabled={!canEdit} onChange={(e) => onPeriod({ ...period, to: e.target.value })} />
      </div>
    </div>
  );
}