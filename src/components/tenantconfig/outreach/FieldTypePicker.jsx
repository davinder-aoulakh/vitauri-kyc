import React from 'react';
import { cn } from '@/lib/utils';

export const FIELD_TYPES = [
  { value: 'file_upload',    label: 'File Upload',     icon: '📄' },
  { value: 'text',           label: 'Text',            icon: 'Aa' },
  { value: 'textarea',       label: 'Long Text',       icon: '¶' },
  { value: 'number',         label: 'Number',          icon: '#' },
  { value: 'date',           label: 'Date',            icon: '📅' },
  { value: 'dropdown',       label: 'Dropdown',        icon: '▾' },
  { value: 'multi_select',   label: 'Multi-select',    icon: '☑' },
  { value: 'checkbox',       label: 'Checkbox',        icon: '✓' },
  { value: 'yes_no',         label: 'Yes / No',        icon: '◐' },
  { value: 'signature',      label: 'Signature',       icon: '✍' },
  { value: 'section_header',   label: 'Section Header',        icon: '—' },
  { value: 'id_verification', label: 'Identity Verification', icon: '🪪', description: 'Client uploads ID document + takes selfie. Faces are compared automatically.' },
];

export default function FieldTypePicker({ value, onChange }) {
  return (
    <div>
      <label className="text-xs font-medium block mb-1.5">Field Type</label>
      <div className="grid grid-cols-4 gap-1.5">
        {FIELD_TYPES.map(ft => (
          <button
            key={ft.value}
            type="button"
            onClick={() => onChange(ft.value)}
            className={cn(
              'flex flex-col items-center gap-1 px-2 py-2.5 rounded-lg border text-xs font-medium transition-all',
              value === ft.value
                ? 'bg-primary text-primary-foreground border-primary shadow-sm'
                : 'bg-card border-border text-muted-foreground hover:bg-muted/50 hover:border-primary/40'
            )}
          >
            <span className="text-base leading-none">{ft.icon}</span>
            <span className="leading-tight text-center">{ft.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}