import React from 'react';
import { Checkbox } from '@/components/ui/checkbox';

const KIND = { id_copy: 'ID copy', statement: 'Statement', kyc_transaction_analysis: 'KYC analysis', correspondence: 'Correspondence' };

export default function AttachmentsList({ report, editable, onToggle }) {
  const list = report.snapshot?.attachments || [];
  return (
    <section className="bg-card border border-border rounded-xl p-4">
      <h2 className="text-sm font-semibold mb-2">Attachments</h2>
      {list.length === 0 && <p className="text-xs text-muted-foreground">No attachments available for this report.</p>}
      <ul className="space-y-1.5">
        {list.map((a) => (
          <li key={a.ref_id} className="flex items-center gap-2 text-sm">
            <Checkbox checked={!!a.selected} disabled={!editable} onCheckedChange={(v) => onToggle(a.ref_id, !!v)} aria-label={a.label} />
            <span className="flex-1 truncate">{a.label}</span>
            <span className="text-[11px] text-muted-foreground">{KIND[a.kind] || a.kind}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}