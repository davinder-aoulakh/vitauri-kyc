import React, { useState } from 'react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Plus, X } from 'lucide-react';

export default function FieldTypeConfig({ fieldType, data, setData }) {
  function set(patch) { setData(d => ({ ...d, ...patch })); }

  function addOption(val) {
    if (!val.trim()) return;
    set({ field_options: [...(data.field_options || []), val.trim()] });
  }

  function removeOption(idx) {
    set({ field_options: (data.field_options || []).filter((_, i) => i !== idx) });
  }

  if (fieldType === 'section_header') {
    return (
      <div className="space-y-3 p-3 bg-muted/30 rounded-lg border border-border">
        <div>
          <label className="text-xs font-medium block mb-1">Section Title</label>
          <Input value={data.section_title || ''} onChange={e => set({ section_title: e.target.value })} className="h-8 text-sm" placeholder="e.g. Identity Documents" />
        </div>
        <div>
          <label className="text-xs font-medium block mb-1">Section Description</label>
          <textarea
            value={data.description || ''}
            onChange={e => set({ description: e.target.value })}
            className="w-full text-sm border border-input rounded-md px-3 py-2 bg-transparent min-h-[60px] resize-none focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            placeholder="Optional description shown below the section header"
          />
        </div>
      </div>
    );
  }

  if (fieldType === 'dropdown' || fieldType === 'multi_select') {
    return (
      <OptionsConfig data={data} set={set} addOption={addOption} removeOption={removeOption} />
    );
  }

  if (fieldType === 'file_upload') {
    const accepted = data.validation_accepted_file_types || [];
    const FILE_OPTS = [
      { label: 'PDF', value: 'pdf' },
      { label: 'JPG / PNG', value: 'jpg' },
      { label: 'Word', value: 'docx' },
      { label: 'Excel', value: 'xlsx' },
    ];
    function toggleFile(v) {
      set({ validation_accepted_file_types: accepted.includes(v) ? accepted.filter(x => x !== v) : [...accepted, v] });
    }
    return (
      <div className="space-y-3 p-3 bg-muted/30 rounded-lg border border-border">
        <div>
          <label className="text-xs font-medium block mb-1.5">Accepted File Types</label>
          <div className="flex flex-wrap gap-2">
            {FILE_OPTS.map(opt => (
              <button key={opt.value} type="button" onClick={() => toggleFile(opt.value)}
                className={`text-xs px-3 py-1.5 rounded-lg border transition-colors ${accepted.includes(opt.value) ? 'bg-primary text-white border-primary' : 'border-border text-muted-foreground hover:bg-muted/50'}`}>
                {opt.label}
              </button>
            ))}
          </div>
        </div>
        <div>
          <label className="text-xs font-medium block mb-1">Max File Size (MB)</label>
          <Input type="number" min="1" max="100" value={data.validation_max_file_size_mb || 25}
            onChange={e => set({ validation_max_file_size_mb: Number(e.target.value) })}
            className="h-8 text-sm w-28" />
        </div>
      </div>
    );
  }

  if (fieldType === 'text' || fieldType === 'textarea') {
    return (
      <div className="flex gap-3 p-3 bg-muted/30 rounded-lg border border-border">
        <div className="flex-1">
          <label className="text-xs font-medium block mb-1">Min Characters</label>
          <Input type="number" min="0" value={data.validation_min_length || ''}
            onChange={e => set({ validation_min_length: e.target.value ? Number(e.target.value) : undefined })}
            className="h-8 text-sm" placeholder="Optional" />
        </div>
        <div className="flex-1">
          <label className="text-xs font-medium block mb-1">Max Characters</label>
          <Input type="number" min="0" value={data.validation_max_length || ''}
            onChange={e => set({ validation_max_length: e.target.value ? Number(e.target.value) : undefined })}
            className="h-8 text-sm" placeholder="Optional" />
        </div>
      </div>
    );
  }

  if (fieldType === 'number') {
    return (
      <div className="flex gap-3 p-3 bg-muted/30 rounded-lg border border-border">
        <div className="flex-1">
          <label className="text-xs font-medium block mb-1">Min Value</label>
          <Input type="number" value={data.validation_min_value ?? ''}
            onChange={e => set({ validation_min_value: e.target.value !== '' ? Number(e.target.value) : undefined })}
            className="h-8 text-sm" placeholder="Optional" />
        </div>
        <div className="flex-1">
          <label className="text-xs font-medium block mb-1">Max Value</label>
          <Input type="number" value={data.validation_max_value ?? ''}
            onChange={e => set({ validation_max_value: e.target.value !== '' ? Number(e.target.value) : undefined })}
            className="h-8 text-sm" placeholder="Optional" />
        </div>
      </div>
    );
  }

  return null;
}

function OptionsConfig({ data, set, addOption, removeOption }) {
  const [input, setInput] = React.useState('');
  const options = data.field_options || [];

  function handleAdd() {
    addOption(input);
    setInput('');
  }

  return (
    <div className="space-y-2 p-3 bg-muted/30 rounded-lg border border-border">
      <label className="text-xs font-medium block">Options</label>
      <div className="flex gap-2">
        <Input
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); handleAdd(); } }}
          className="h-8 text-sm flex-1"
          placeholder="Add an option…"
        />
        <Button type="button" size="sm" variant="outline" className="h-8" onClick={handleAdd} disabled={!input.trim()}>
          <Plus className="w-3.5 h-3.5" />
        </Button>
      </div>
      {options.length > 0 && (
        <div className="flex flex-wrap gap-1.5 pt-1">
          {options.map((opt, i) => (
            <span key={i} className="inline-flex items-center gap-1 text-xs bg-card border border-border rounded-full px-2.5 py-1">
              {opt}
              <button type="button" onClick={() => removeOption(i)} className="text-muted-foreground hover:text-destructive">
                <X className="w-3 h-3" />
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}