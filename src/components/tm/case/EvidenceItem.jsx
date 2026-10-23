import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Check, Pencil, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { EVIDENCE_MARK } from '@/lib/tmCase';
import SourceChips from '@/components/tm/kit/SourceChips';

export default function EvidenceItem({ item, canEdit, busy, onAccept, onSave }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(item.text);
  const mark = EVIDENCE_MARK[item.kind] || EVIDENCE_MARK.unclear;

  const save = async () => { if (await onSave(item.id, text.trim())) setEditing(false); };

  return (
    <li className="flex gap-3 py-3 border-b border-border last:border-0">
      <span title={mark.label} className={cn('w-6 h-6 rounded-full flex items-center justify-center text-sm font-bold flex-shrink-0', mark.cls)}>{mark.symbol}</span>
      <div className="flex-1 min-w-0 space-y-1.5">
        {editing ? (
          <>
            <Textarea value={text} onChange={(e) => setText(e.target.value)} className="text-sm min-h-16" />
            <div className="flex gap-2">
              <Button size="sm" className="h-7 text-xs" disabled={!text.trim() || busy} onClick={save}>Save and accept</Button>
              <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => { setEditing(false); setText(item.text); }}>Cancel</Button>
            </div>
          </>
        ) : (
          <p className="text-sm text-foreground">{item.text}</p>
        )}
        <div className="flex flex-wrap items-center gap-1.5">
          <SourceChips refs={item.source_refs} />
          {item.accepted && <span className="text-[11px] text-emerald-700 font-medium">Accepted{item.edited ? ' (edited)' : ''}</span>}
          {!item.accepted && <span className="text-[11px] text-muted-foreground">Proposed by {item.by === 'user' ? 'user' : 'AI'}, not yet accepted</span>}
        </div>
      </div>
      {canEdit && !editing && (
        <div className="flex gap-1.5 flex-shrink-0 self-start">
          {!item.accepted && (
            <Button size="sm" variant="outline" className="h-7 text-xs gap-1" disabled={busy} onClick={() => onAccept(item.id)}>
              {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />} Accept
            </Button>
          )}
          <Button size="sm" variant="ghost" className="h-7 text-xs gap-1" disabled={busy} onClick={() => setEditing(true)}><Pencil className="w-3 h-3" /> Edit</Button>
        </div>
      )}
    </li>
  );
}