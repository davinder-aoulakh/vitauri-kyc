import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Link } from 'react-router-dom';
import { OUTCOME_LABEL } from '@/lib/tmQuality';
import { Loader2 } from 'lucide-react';

const NONE = '__none__';

/** One sample item: summary plus the reviewer controls (or the recorded outcome). */
export default function WorklistItem({ item, type, open, userId, scenarios, busy, onReview }) {
  const [note, setNote] = useState('');
  const [scenarioId, setScenarioId] = useState(NONE);
  const finding = type === 'below_the_line' ? 'missed_signal' : 'wrongly_closed';
  const own = type === 'file_review' && !!userId && item.closed_by_user_id === userId;
  const save = (outcome) => onReview(item.ref_id, outcome, note, scenarioId === NONE ? undefined : scenarioId);

  return (
    <li className="py-2.5 px-1 text-sm">
      <div className="flex items-start gap-3">
        <div className="flex-1 min-w-0">
          <div className="truncate">{item.summary || item.ref_id}</div>
          <div className="text-[11px] text-muted-foreground">
            {item.ref_type} {item.ref_id}{item.ref_type === 'alert' && <> · <Link className="text-primary hover:underline" to="/tm/alerts">alerts</Link></>}
          </div>
        </div>
        {item.outcome !== 'pending' && <span className="text-xs font-medium whitespace-nowrap">{OUTCOME_LABEL[item.outcome]}</span>}
      </div>
      {item.outcome !== 'pending' && item.note && <div className="text-xs text-muted-foreground mt-1">{item.note}</div>}
      {open && item.outcome === 'pending' && (
        own ? <p className="text-xs text-muted-foreground mt-1">You closed this alert. Another reviewer must review it.</p> : (
          <div className="flex flex-wrap items-center gap-2 mt-2">
            <Input className="h-8 flex-1 min-w-40" placeholder="Note (required for a finding)" value={note} maxLength={1000} onChange={(e) => setNote(e.target.value)} />
            {type === 'below_the_line' && (
              <Select value={scenarioId} onValueChange={setScenarioId}>
                <SelectTrigger className="h-8 w-44"><SelectValue placeholder="Scenario (optional)" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>No scenario</SelectItem>
                  {scenarios.map((s) => <SelectItem key={s.id} value={s.id}>{s.code} · {s.name}</SelectItem>)}
                </SelectContent>
              </Select>
            )}
            <Button size="sm" variant="outline" disabled={!!busy} onClick={() => save('ok')}>OK</Button>
            <Button size="sm" variant="outline" className="text-red-700" disabled={!!busy || !note.trim()} onClick={() => save(finding)}>
              {busy === `review:${item.ref_id}` && <Loader2 className="w-3.5 h-3.5 animate-spin" />} {OUTCOME_LABEL[finding]}
            </Button>
          </div>
        )
      )}
    </li>
  );
}