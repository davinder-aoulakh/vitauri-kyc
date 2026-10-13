import React from 'react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { ChevronDown } from 'lucide-react';

function CodePicker({ options, value, onChange, disabled }) {
  const toggle = (code) => onChange(value.includes(code) ? value.filter((c) => c !== code) : [...value, code]);
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button type="button" variant="outline" size="sm" disabled={disabled || options.length === 0} className="h-7 text-xs gap-1 max-w-[16rem] justify-between">
          <span className="truncate">{value.length ? value.join(', ') : options.length ? 'Select codes' : 'No codes defined'}</span>
          <ChevronDown className="w-3 h-3 flex-shrink-0" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64 max-h-64 overflow-y-auto p-2 space-y-1">
        {options.map((c) => (
          <label key={c.code} className="flex items-center gap-2 text-xs cursor-pointer rounded px-1.5 py-1 hover:bg-muted">
            <Checkbox checked={value.includes(c.code)} onCheckedChange={() => toggle(c.code)} />
            <span className="font-mono">{c.code}</span><span className="text-muted-foreground truncate">{c.label}</span>
          </label>
        ))}
      </PopoverContent>
    </Popover>
  );
}

export default function ScenarioMapping({ scenarios, codes, mappings, onChange, disabled }) {
  const valid = codes.map((c) => c.code).filter(Boolean);
  const options = codes.filter((c) => c.code);
  return (
    <div className="space-y-2">
      <h4 className="text-xs font-semibold">Scenario to indicator code mapping</h4>
      {scenarios.length === 0 ? <p className="text-xs text-muted-foreground">No scenarios yet. Load defaults to create the scenario library.</p> : (
        <div className="overflow-x-auto border border-border rounded-lg">
          <table className="w-full text-xs">
            <thead className="bg-muted/50 text-left text-[11px] uppercase tracking-wide text-muted-foreground">
              <tr><th className="p-2 font-medium">Scenario</th><th className="p-2 font-medium">Indicator codes</th></tr>
            </thead>
            <tbody>
              {scenarios.map((s) => (
                <tr key={s.id} className="border-t border-border">
                  <td className="p-2"><span className="font-mono">{s.code}</span> <span className="text-muted-foreground">{s.name}</span></td>
                  <td className="p-1.5"><CodePicker options={options} disabled={disabled} value={(mappings[s.id] || []).filter((c) => valid.includes(c))} onChange={(v) => onChange(s.id, v)} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}