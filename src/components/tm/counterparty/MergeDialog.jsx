import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import InlineError from '@/components/shared/InlineError';
import IdentifierColumn from '@/components/tm/counterparty/IdentifierColumn';
import { fetchCounterparties, mergeCounterparty, errText } from '@/lib/tmCounterparty';
import { Loader2 } from 'lucide-react';

/** "Merge into…": search a target, compare identifiers side by side, give a reason. Mount only while open. */
export default function MergeDialog({ source, tenantId, onOpenChange, onDone }) {
  const [q, setQ] = useState('');
  const [target, setTarget] = useState(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const term = q.trim();

  const { data, isFetching } = useQuery({
    queryKey: ['counterparty-picker', tenantId, term],
    enabled: term.length >= 2 && !target,
    queryFn: () => fetchCounterparties({ q: term, limit: 10 }),
  });
  const options = (data?.counterparties || []).filter((c) => c.id !== source.id);

  const confirm = async () => {
    setBusy(true); setError('');
    try { await mergeCounterparty({ targetId: target.id, sourceId: source.id, reason: reason.trim() }); await onDone(); onOpenChange(false); } catch (e) { setError(errText(e, 'Could not merge.')); } finally { setBusy(false); }
  };

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader><DialogTitle>Merge “{source.display_name}” into…</DialogTitle></DialogHeader>
        {!target ? (
          <div className="space-y-2">
            <Input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by name or identifier (2+ characters)" />
            {isFetching && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
            {term.length >= 2 && !isFetching && options.length === 0 && <p className="text-xs text-muted-foreground">No other counterparty found.</p>}
            <ul className="divide-y divide-border rounded-lg border border-border">
              {options.map((c) => (
                <li key={c.id}>
                  <button type="button" onClick={() => setTarget(c)} className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-muted/50">
                    <span className="truncate">{c.display_name}</span>
                    <span className="text-xs text-muted-foreground">{c.country || '—'} · {c.transaction_count} txn</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="grid gap-4 rounded-lg border border-border p-3 sm:grid-cols-2">
              <IdentifierColumn cp={source} heading="Merged away (this one)" />
              <IdentifierColumn cp={target} heading="Kept (target)" />
            </div>
            <p className="text-xs text-muted-foreground">All transactions of “{source.display_name}” move to “{target.display_name}” and customer risk is recomputed. You can unmerge later.</p>
            <Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} placeholder="Reason (required)" />
          </div>
        )}
        {error && <InlineError message={error} />}
        <DialogFooter>
          {target && <Button variant="ghost" onClick={() => setTarget(null)} disabled={busy}>Back</Button>}
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>Cancel</Button>
          {target && <Button onClick={confirm} disabled={busy || !reason.trim()} className="gap-2">{busy && <Loader2 className="h-4 w-4 animate-spin" />} Confirm merge</Button>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}