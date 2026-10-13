import React, { useRef, useState } from 'react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import InlineError from '@/components/shared/InlineError';
import { Plus, Trash2, Upload } from 'lucide-react';
import { parseIndicatorCsv } from '@/lib/fiuProfile';

export default function IndicatorCodesTable({ codes, onChange, disabled }) {
  const fileRef = useRef(null);
  const [errors, setErrors] = useState([]);
  const [info, setInfo] = useState('');

  const edit = (i, patch) => onChange(codes.map((c, idx) => (idx === i ? { ...c, ...patch } : c)));
  const add = () => onChange([...codes, { code: '', label: '', type: 'subjective', sector: '' }]);

  const importCsv = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const { rows, errors: errs } = parseIndicatorCsv(await file.text(), codes.map((c) => c.code));
    setErrors(errs.slice(0, 6));
    setInfo('');
    if (errs.length) return;
    onChange([...codes, ...rows]);
    setInfo(`Imported ${rows.length} indicator code${rows.length === 1 ? '' : 's'}. Save the profile to keep them.`);
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <h4 className="text-xs font-semibold">Indicator codes</h4>
        {!disabled && (
          <div className="flex gap-1.5">
            <input ref={fileRef} type="file" accept=".csv,text/csv" className="hidden" onChange={importCsv} />
            <Button type="button" size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={() => fileRef.current?.click()}><Upload className="w-3 h-3" /> Import CSV</Button>
            <Button type="button" size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={add}><Plus className="w-3 h-3" /> Add row</Button>
          </div>
        )}
      </div>
      <p className="text-[11px] text-muted-foreground">CSV columns: code,label,type,sector. Take the codes from the official FIU lists.</p>
      {errors.length > 0 && <InlineError message={`Import rejected: ${errors.join(' · ')}`} />}
      {info && <p className="text-xs text-emerald-700">{info}</p>}
      <div className="overflow-x-auto border border-border rounded-lg">
        <table className="w-full text-xs">
          <thead className="bg-muted/50 text-left text-[11px] uppercase tracking-wide text-muted-foreground">
            <tr><th className="p-2 font-medium">Code</th><th className="p-2 font-medium">Label</th><th className="p-2 font-medium">Type</th><th className="p-2 font-medium">Sector</th><th className="w-8" /></tr>
          </thead>
          <tbody>
            {codes.length === 0 && <tr><td colSpan={5} className="p-3 text-center text-muted-foreground">No indicator codes yet.</td></tr>}
            {codes.map((c, i) => (
              <tr key={i} className="border-t border-border">
                <td className="p-1.5"><Input value={c.code} disabled={disabled} className="h-7 text-xs font-mono w-24" onChange={(e) => edit(i, { code: e.target.value })} /></td>
                <td className="p-1.5"><Input value={c.label} disabled={disabled} className="h-7 text-xs min-w-40" onChange={(e) => edit(i, { label: e.target.value })} /></td>
                <td className="p-1.5">
                  <Select value={c.type} disabled={disabled} onValueChange={(v) => edit(i, { type: v })}>
                    <SelectTrigger className="h-7 text-xs w-28"><SelectValue /></SelectTrigger>
                    <SelectContent><SelectItem value="objective">Objective</SelectItem><SelectItem value="subjective">Subjective</SelectItem></SelectContent>
                  </Select>
                </td>
                <td className="p-1.5"><Input value={c.sector} disabled={disabled} className="h-7 text-xs w-28" onChange={(e) => edit(i, { sector: e.target.value })} /></td>
                <td className="p-1.5">{!disabled && <Button type="button" size="icon" variant="ghost" className="h-7 w-7" aria-label="Remove row" onClick={() => onChange(codes.filter((_, idx) => idx !== i))}><Trash2 className="w-3.5 h-3.5" /></Button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}