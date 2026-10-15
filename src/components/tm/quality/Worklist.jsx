import React, { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import WorklistItem from '@/components/tm/quality/WorklistItem';
import { SAMPLE_LABEL } from '@/lib/tmQuality';
import { Loader2 } from 'lucide-react';

const PAGE = 20;

/** Reviewer worklist for one sample. Pending items first; completed samples are read-only. */
export default function Worklist({ sample, userId, scenarios, busy, onReview, onComplete }) {
  const [shown, setShown] = useState(PAGE);
  const [onlyPending, setOnlyPending] = useState(true);
  useEffect(() => { setShown(PAGE); setOnlyPending(true); }, [sample.id]);
  const open = sample.status === 'open';
  const items = sample.items || [];
  const pending = items.filter((i) => i.outcome === 'pending').length;
  const list = (open && onlyPending ? items.filter((i) => i.outcome === 'pending') : items);

  return (
    <section className="bg-card border border-border rounded-xl p-4 mt-5">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
        <h2 className="text-sm font-semibold">
          {SAMPLE_LABEL[sample.sample_type]} worklist · {items.length - pending} of {items.length} reviewed
          {sample.truncated && <span className="ml-2 text-xs font-normal text-amber-700">Population was capped</span>}
        </h2>
        <div className="flex gap-2">
          {open && <Button size="sm" variant="ghost" onClick={() => setOnlyPending(!onlyPending)}>{onlyPending ? 'Show all' : 'Show pending'}</Button>}
          {open && (
            <Button size="sm" disabled={pending > 0 || !!busy} title={pending ? `${pending} item(s) still to review` : ''} onClick={onComplete}>
              {busy === 'complete' && <Loader2 className="w-3.5 h-3.5 animate-spin" />} Complete sample
            </Button>
          )}
        </div>
      </div>
      {list.length === 0 && <p className="text-sm text-muted-foreground py-4 text-center">Nothing left to review.</p>}
      <ul className="divide-y divide-border">
        {list.slice(0, shown).map((i) => (
          <WorklistItem key={i.ref_id} item={i} type={sample.sample_type} open={open} userId={userId} scenarios={scenarios} busy={busy} onReview={onReview} />
        ))}
      </ul>
      {list.length > shown && <Button size="sm" variant="ghost" className="mt-2" onClick={() => setShown(shown + PAGE)}>Show more ({list.length - shown})</Button>}
    </section>
  );
}