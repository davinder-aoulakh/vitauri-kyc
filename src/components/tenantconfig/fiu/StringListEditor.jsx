import React, { useState } from 'react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Plus, X } from 'lucide-react';

export default function StringListEditor({ items, onChange, placeholder, type = 'text', disabled }) {
  const [value, setValue] = useState('');
  const add = () => {
    const v = value.trim();
    if (!v || items.includes(v)) return;
    onChange([...items, v]);
    setValue('');
  };
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1.5">
        {items.length === 0 && <span className="text-xs text-muted-foreground">None added.</span>}
        {items.map((it) => (
          <span key={it} className="inline-flex items-center gap-1 bg-muted rounded-full pl-2.5 pr-1 py-0.5 text-xs font-mono">
            {it}
            {!disabled && <button type="button" aria-label={`Remove ${it}`} className="p-0.5 hover:text-destructive" onClick={() => onChange(items.filter((x) => x !== it))}><X className="w-3 h-3" /></button>}
          </span>
        ))}
      </div>
      {!disabled && (
        <div className="flex gap-2">
          <Input type={type} value={value} placeholder={placeholder} className="h-8 text-xs" onChange={(e) => setValue(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } }} />
          <Button type="button" size="sm" variant="outline" className="h-8 gap-1 text-xs" onClick={add}><Plus className="w-3 h-3" /> Add</Button>
        </div>
      )}
    </div>
  );
}