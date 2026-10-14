import React from 'react';
import FieldRow from '@/components/tm/report/FieldRow';

export default function FieldsTable({ report, editable, editing, busy, onSave }) {
  const missing = (report.missing_fields || []).map((p) => ({ path: p, label: p, value: '' }));
  const rows = [...missing.map((f) => ({ f, m: true })), ...(report.fields || []).map((f) => ({ f, m: false }))];
  return (
    <section className="bg-card border border-border rounded-xl overflow-hidden">
      <h2 className="px-4 py-3 text-sm font-semibold border-b border-border">Report content</h2>
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-[11px] uppercase tracking-wider text-muted-foreground border-b border-border">
            <th className="px-3 py-2 font-semibold">Field</th><th className="px-3 py-2 font-semibold">Value</th><th className="px-3 py-2 font-semibold">Source</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ f, m }) => <FieldRow key={`${f.path}-${f.value}`} field={f} missing={m} editable={editable} editing={editing} busy={busy} onSave={onSave} />)}
        </tbody>
      </table>
    </section>
  );
}