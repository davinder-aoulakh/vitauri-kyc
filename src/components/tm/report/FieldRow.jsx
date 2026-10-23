import React, { useState } from 'react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { sourceTone, TONE_CLASS } from '@/lib/fiuReport';
import { cn } from '@/lib/utils';
import StatusPill from '@/components/tm/kit/StatusPill';

/** One report field. Missing rows (amber) always show an input; filled rows show one in edit mode. */
export default function FieldRow({ field, missing, editable, editing, busy, onSave }) {
  const [value, setValue] = useState(field?.value || '');
  const showInput = editable && (missing || editing);
  const label = field?.label || field.path;
  const tone = field?.source === 'Didit' ? 'green' : sourceTone(field);
  return (
    <tr className={cn('border-b border-border last:border-0 align-top', missing && 'bg-amber-50')}>
      <td className="px-3 py-2 text-muted-foreground w-[38%]">
        {label}
        {missing && <div className="text-[10px] text-amber-700" title={field.path}>Required by the FIU profile</div>}
      </td>
      <td className="px-3 py-2">
        {showInput ? (
          <div className="flex gap-2">
            <Input value={value} onChange={(e) => setValue(e.target.value)} className="h-8" aria-label={label} />
            <Button size="sm" className="h-8" disabled={busy || value.trim() === (field.value || '')} onClick={() => onSave(field.path, value)}>Save</Button>
          </div>
        ) : <span className="break-words">{field.value}</span>}
      </td>
      <td className="px-3 py-2 w-28">
        {missing
          ? <StatusPill tone="warning">Input needed</StatusPill>
          : <span className={cn('text-[11px] px-2 py-0.5 rounded-full border', TONE_CLASS[tone])}>{field.source || '—'}</span>}
      </td>
    </tr>
  );
}