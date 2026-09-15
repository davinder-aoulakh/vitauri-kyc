import React from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { COUNTRIES } from '@/lib/countries';

// Structured address editor — country, street+number, zipcode+city, area.
// value: { country, street, number, zipcode, city, area } | undefined
export default function AddressFields({ title, value, onChange, optionalNote }) {
  const addr = value || {};
  const set = (field, v) => onChange({ ...addr, [field]: v });

  return (
    <div className="border border-border rounded-lg p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">{title}</div>
        {optionalNote && <span className="text-xs text-muted-foreground italic">{optionalNote}</span>}
      </div>
      <div>
        <Label className="text-xs font-medium mb-1.5 block">Country</Label>
        <Select value={addr.country || ''} onValueChange={v => set('country', v)}>
          <SelectTrigger className="h-9 text-sm"><SelectValue placeholder="Select country" /></SelectTrigger>
          <SelectContent>{COUNTRIES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
        </Select>
      </div>
      <div className="grid grid-cols-3 gap-3">
        <div className="col-span-2">
          <Label className="text-xs font-medium mb-1.5 block">Street</Label>
          <Input value={addr.street || ''} onChange={e => set('street', e.target.value)} className="h-9 text-sm" />
        </div>
        <div>
          <Label className="text-xs font-medium mb-1.5 block">Number</Label>
          <Input value={addr.number || ''} onChange={e => set('number', e.target.value)} className="h-9 text-sm" />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label className="text-xs font-medium mb-1.5 block">Zipcode</Label>
          <Input value={addr.zipcode || ''} onChange={e => set('zipcode', e.target.value)} className="h-9 text-sm" />
        </div>
        <div>
          <Label className="text-xs font-medium mb-1.5 block">City</Label>
          <Input value={addr.city || ''} onChange={e => set('city', e.target.value)} className="h-9 text-sm" />
        </div>
      </div>
      <div>
        <Label className="text-xs font-medium mb-1.5 block">Area</Label>
        <Input value={addr.area || ''} onChange={e => set('area', e.target.value)} className="h-9 text-sm" />
      </div>
    </div>
  );
}