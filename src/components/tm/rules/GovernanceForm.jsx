import React, { useEffect, useState } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { userName } from '@/lib/tmRules';
import { Loader2 } from 'lucide-react';

const NONE = '__none__';

/** Scenario, owner, review date and change note. Saved without touching the rule definition. */
export default function GovernanceForm({ rule, scenarios, users, canEdit, busy, onSave }) {
  const [f, setF] = useState({});
  useEffect(() => {
    setF({ scenario_id: rule.scenario_id || '', owner_user_id: rule.owner_user_id || '', review_date: rule.review_date || '', change_note: '' });
  }, [rule.id, rule.updated_date]);
  const set = (k) => (v) => setF((p) => ({ ...p, [k]: v === NONE ? '' : v }));
  const pick = (k, label, items) => (
    <div>
      <Label className="text-xs">{label}</Label>
      <Select value={f[k] || NONE} onValueChange={set(k)} disabled={!canEdit}>
        <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value={NONE}>None</SelectItem>
          {items.map((i) => <SelectItem key={i.id} value={i.id}>{i.label}</SelectItem>)}
        </SelectContent>
      </Select>
    </div>
  );
  return (
    <div className="grid grid-cols-2 gap-3 mb-3">
      {pick('scenario_id', 'Scenario', scenarios.map((s) => ({ id: s.id, label: `${s.code} · ${s.name}` })))}
      {pick('owner_user_id', 'Owner', users.map((u) => ({ id: u.id, label: userName(u) })))}
      <div>
        <Label className="text-xs">Review date</Label>
        <Input type="date" className="h-8" value={f.review_date || ''} disabled={!canEdit} onChange={(e) => set('review_date')(e.target.value)} />
      </div>
      <div>
        <Label className="text-xs">Change note</Label>
        <Input className="h-8" value={f.change_note || ''} disabled={!canEdit} maxLength={400} onChange={(e) => set('change_note')(e.target.value)} placeholder="What changed and why" />
      </div>
      {canEdit && (
        <div className="col-span-2">
          <Button size="sm" variant="outline" disabled={!!busy} onClick={() => onSave(f)}>{busy === 'save' && <Loader2 className="w-3.5 h-3.5 animate-spin" />} Save details</Button>
        </div>
      )}
    </div>
  );
}