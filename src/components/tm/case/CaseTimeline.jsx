import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { format } from 'date-fns';

export default function CaseTimeline({ timeline, canWork, run, busy }) {
  const [note, setNote] = useState('');
  const rows = [...(timeline || [])].reverse();
  const add = async () => { if (await run('add_note', { text: note }, { success: 'Note added' })) setNote(''); };

  return (
    <section className="bg-card border border-border rounded-xl p-5 mt-5">
      <h2 className="text-sm font-semibold mb-3">Timeline</h2>
      {canWork && (
        <div className="flex gap-2 mb-4">
          <Textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Add a note to the case" className="min-h-10 text-sm" />
          <Button size="sm" disabled={!note.trim() || busy === 'add_note'} onClick={add}>Add note</Button>
        </div>
      )}
      <ol className="space-y-3 border-l border-border ml-1.5">
        {rows.map((t, i) => (
          <li key={`${t.at}-${i}`} className="pl-4 relative">
            <span className="absolute -left-[5px] top-1.5 w-2 h-2 rounded-full bg-primary" />
            <div className="text-sm text-foreground">{t.text}</div>
            <div className="text-[11px] text-muted-foreground">{t.at ? format(new Date(t.at), 'd MMM yyyy HH:mm') : ''}{t.by ? ` · ${t.by}` : ''}</div>
          </li>
        ))}
      </ol>
    </section>
  );
}