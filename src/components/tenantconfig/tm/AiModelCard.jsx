import React from 'react';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { AI_MODEL_OPTIONS, MIN_NOTE, modelLabel } from '@/lib/tmAiModels';

/** Pin the AI model used by TM agents. Changing it needs a note and a Compliance Admin / Officer. */
export default function AiModelCard({ saved, value, onChange, note, onNote, canChange, changedAt }) {
  const changed = value !== saved.model;
  const options = AI_MODEL_OPTIONS.some((o) => o.value === saved.model) ? AI_MODEL_OPTIONS : [...AI_MODEL_OPTIONS, { value: saved.model, label: saved.model }];
  return (
    <div className="max-w-xl space-y-2">
      <Label className="text-xs block">AI model for monitoring agents</Label>
      {canChange ? (
        <Select value={value || 'automatic'} onValueChange={(v) => onChange(v === 'automatic' ? '' : v)}>
          <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
          <SelectContent>{options.map((o) => <SelectItem key={o.value || 'automatic'} value={o.value || 'automatic'}>{o.label}</SelectItem>)}</SelectContent>
        </Select>
      ) : (
        <div className="h-9 rounded-md border border-input bg-muted/40 px-3 text-sm leading-9">{modelLabel(saved.model)}</div>
      )}
      <p className="text-xs text-muted-foreground">
        {canChange ? 'Pinning a model keeps AI proposals reproducible. ' : 'Only a Compliance Admin or Compliance Officer can change the model. '}
        {changedAt ? `Last changed ${changedAt.slice(0, 10)}${saved.note ? `: ${saved.note}` : ''}.` : 'Never changed.'}
      </p>
      {canChange && changed && (
        <div>
          <Label className="text-xs mb-1 block">Change note (min {MIN_NOTE} characters)</Label>
          <Textarea value={note} onChange={(e) => onNote(e.target.value)} rows={2} />
          {note.trim().length < MIN_NOTE && <p className="mt-1 text-xs text-red-600">{note.trim().length}/{MIN_NOTE} characters.</p>}
        </div>
      )}
    </div>
  );
}