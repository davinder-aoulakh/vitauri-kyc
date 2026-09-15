import React from 'react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Plus, Trash2 } from 'lucide-react';
import { setPreferredEntry } from '@/lib/clientNameUtils';

const TYPES = ['email', 'phone', 'mobile'];

// entries: [{ type, value, is_preferred }]
export default function ContactEntriesTable({ entries, onChange }) {
  const list = entries || [];

  function addRow() {
    onChange([...list, { type: 'email', value: '', is_preferred: list.length === 0 }]);
  }
  function updateRow(idx, field, val) {
    onChange(list.map((e, i) => (i === idx ? { ...e, [field]: val } : e)));
  }
  function removeRow(idx) {
    onChange(list.filter((_, i) => i !== idx));
  }
  function setPreferred(idx, type) {
    onChange(setPreferredEntry(list, idx, type));
  }

  return (
    <div className="space-y-2">
      {list.length > 0 && (
        <div className="grid grid-cols-[110px_1fr_70px_32px] gap-2 px-1 text-xs font-medium text-muted-foreground">
          <span>Type</span><span>Value</span><span className="text-center">Preferred</span><span />
        </div>
      )}
      {list.map((entry, idx) => (
        <div key={idx} className="grid grid-cols-[110px_1fr_70px_32px] gap-2 items-center">
          <Select value={entry.type} onValueChange={v => updateRow(idx, 'type', v)}>
            <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
            <SelectContent>{TYPES.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
          </Select>
          <Input
            value={entry.value || ''}
            onChange={e => updateRow(idx, 'value', e.target.value)}
            placeholder={entry.type === 'email' ? 'name@example.com' : '+31 6 12345678'}
            className="h-9 text-sm"
          />
          <div className="flex justify-center">
            <input
              type="checkbox"
              checked={!!entry.is_preferred}
              onChange={() => setPreferred(idx, entry.type)}
              className="w-4 h-4 accent-primary cursor-pointer"
            />
          </div>
          <button onClick={() => removeRow(idx)} className="text-muted-foreground hover:text-red-500">
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      ))}
      <Button type="button" variant="outline" size="sm" className="h-8 text-xs gap-1.5" onClick={addRow}>
        <Plus className="w-3.5 h-3.5" /> Add contact
      </Button>
    </div>
  );
}