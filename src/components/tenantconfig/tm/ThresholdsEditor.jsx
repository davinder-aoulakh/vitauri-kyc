import React from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Plus, X } from 'lucide-react';

/** Objective threshold amount per currency. value: { USD: 10000 }. */
export default function ThresholdsEditor({ value, onChange, reportingCurrency }) {
  const rows = Object.entries(value);
  const setRow = (oldCur, cur, amount) => {
    const next = {};
    rows.forEach(([c, v]) => { if (c === oldCur) next[cur.toUpperCase()] = amount; else next[c] = v; });
    onChange(next);
  };
  const remove = (cur) => onChange(Object.fromEntries(rows.filter(([c]) => c !== cur)));
  const add = () => onChange({ ...value, [value[reportingCurrency] === undefined ? reportingCurrency : '']: '' });

  return (
    <div>
      <Label className="text-xs mb-1.5 block">Objective threshold amounts per currency</Label>
      <div className="space-y-2 max-w-md">
        {rows.map(([cur, amount], i) => (
          <div key={i} className="flex items-center gap-2">
            <Input maxLength={3} placeholder="USD" value={cur} onChange={(e) => setRow(cur, e.target.value, amount)} className="h-9 w-20 text-sm" />
            <Input type="number" min="0" placeholder="Amount" value={amount} onChange={(e) => setRow(cur, cur, e.target.value)} className="h-9 text-sm" />
            <Button size="icon" variant="ghost" aria-label="Remove" onClick={() => remove(cur)}><X className="w-4 h-4" /></Button>
          </div>
        ))}
        <Button size="sm" variant="outline" className="gap-1.5 text-xs" onClick={add}><Plus className="w-3.5 h-3.5" /> Add currency</Button>
      </div>
      <p className="text-xs text-muted-foreground mt-1">The reporting-currency amount is used by the starter rules and auto-draft.</p>
    </div>
  );
}