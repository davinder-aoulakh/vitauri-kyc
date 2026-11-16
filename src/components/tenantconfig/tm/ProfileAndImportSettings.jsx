// TM settings added in phase 10 (KYC + AML layout): behaviour-score threshold, segment defaults for the expected
// profile, and column-mapping templates for CSV / Excel statements. Controlled: the parent tab saves them with the
// other TM settings (one audit event).
import React, { useState } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Trash2, Plus } from 'lucide-react';
import { SEGMENT_KEYS, LIMIT_FIELDS } from '@/lib/tmProfileSources';
import { TEMPLATE_FIELDS, MAX_TEMPLATES, cleanTemplate } from '@/lib/tmCsvTemplates';

const LIMIT_LABEL = { inbound_max_month: 'Incoming / month', outbound_max_month: 'Outgoing / month', max_single_txn: 'Largest transaction', cash_max_month: 'Cash / month' };
const SEGMENT_LABEL = { NP_Low: 'Person · Low', NP_Medium: 'Person · Medium', NP_High: 'Person · High', ORG_Low: 'Organisation · Low', ORG_Medium: 'Organisation · Medium', ORG_High: 'Organisation · High' };
const FIELD_LABEL = { date: 'Date *', amount: 'Amount', debit: 'Debit', credit: 'Credit', balance: 'Balance', currency: 'Currency', description: 'Description', counterparty: 'Counterparty', direction: 'Direction' };

export function BehaviourThresholdField({ value, onChange }) {
  const n = Number(value);
  const invalid = value !== '' && !(Number.isFinite(n) && n >= 1 && n <= 100);
  return (
    <div className="max-w-md">
      <Label className="text-xs mb-1.5 block">Behaviour score: propose a risk review from</Label>
      <Input type="number" min="1" max="100" step="1" value={value} onChange={(e) => onChange(e.target.value)} placeholder="Off" className="h-9 text-sm w-32" aria-invalid={invalid} />
      <p className="mt-1 text-xs text-muted-foreground">
        When a customer's behaviour score (0–100, part of the dynamic risk) reaches this number, a change of circumstances proposes a risk review, at most once per customer per month.
        Leave empty to switch it off. The official risk class never changes by itself.
      </p>
    </div>
  );
}

export function SegmentDefaultsEditor({ value, onChange, currency }) {
  const set = (seg, field, v) => onChange({ ...value, [seg]: { ...(value[seg] || {}), [field]: v.replace(/[^\d.]/g, '') } });
  return (
    <div>
      <Label className="text-xs mb-1.5 block">Expected profile: segment defaults ({currency})</Label>
      <p className="mb-2 text-xs text-muted-foreground">Used for a limit that neither the client's declaration nor a transaction analysis gives. The values shown first are demo values: set your own.</p>
      <div className="overflow-x-auto border border-border rounded-lg">
        <table className="w-full text-xs">
          <thead><tr className="bg-muted/40 text-left text-muted-foreground">
            <th className="px-3 py-2">Segment</th>{LIMIT_FIELDS.map((f) => <th key={f} className="px-3 py-2">{LIMIT_LABEL[f]}</th>)}
          </tr></thead>
          <tbody className="divide-y divide-border">
            {SEGMENT_KEYS.map((seg) => (
              <tr key={seg}>
                <td className="px-3 py-1.5 whitespace-nowrap">{SEGMENT_LABEL[seg]}</td>
                {LIMIT_FIELDS.map((f) => (
                  <td key={f} className="px-3 py-1.5">
                    <Input value={String(value[seg]?.[f] ?? '')} inputMode="decimal" onChange={(e) => set(seg, f, e.target.value)} className="h-8 text-xs w-28" aria-label={`${SEGMENT_LABEL[seg]} ${LIMIT_LABEL[f]}`} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function CsvTemplatesEditor({ value, onChange }) {
  const empty = { name: '', by_header: {} };
  const [draft, setDraft] = useState(empty);
  const cleaned = cleanTemplate(draft);
  const duplicate = !!cleaned && value.some((t) => t.id === cleaned.id);
  const add = () => { if (!cleaned || duplicate) return; onChange([...value, cleaned]); setDraft(empty); };
  return (
    <div>
      <Label className="text-xs mb-1.5 block">CSV / Excel mapping templates</Label>
      <p className="mb-2 text-xs text-muted-foreground">
        A template names the column headers of one bank's export. When a file has all of a template's headers it is read with that template; otherwise the columns are detected automatically, as before.
        MT940 and CAMT.053 need no template.
      </p>
      {value.length > 0 && (
        <div className="border border-border rounded-lg divide-y divide-border mb-3">
          {value.map((t) => (
            <div key={t.id} className="flex items-start gap-3 px-3 py-2 text-xs">
              <div className="flex-1 min-w-0">
                <div className="font-medium text-foreground">{t.name}</div>
                <div className="text-muted-foreground break-words">{Object.entries(t.by_header).map(([f, h]) => `${f}: "${h}"`).join(' · ')}</div>
              </div>
              <Button type="button" size="sm" variant="ghost" className="h-7 px-2" onClick={() => onChange(value.filter((x) => x.id !== t.id))} aria-label={`Remove ${t.name}`}><Trash2 className="w-3.5 h-3.5" /></Button>
            </div>
          ))}
        </div>
      )}
      {value.length < MAX_TEMPLATES && (
        <div className="border border-dashed border-border rounded-lg p-3 space-y-2">
          <Input value={draft.name} onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))} placeholder="Template name, e.g. ABN AMRO CSV export" className="h-8 text-xs max-w-sm" />
          <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
            {TEMPLATE_FIELDS.map((f) => (
              <div key={f}>
                <Label className="text-[11px] text-muted-foreground mb-0.5 block">{FIELD_LABEL[f]}</Label>
                <Input value={draft.by_header[f] || ''} onChange={(e) => setDraft((d) => ({ ...d, by_header: { ...d.by_header, [f]: e.target.value } }))} placeholder="Header text in the file" className="h-8 text-xs" />
              </div>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <Button type="button" size="sm" variant="outline" className="h-7 gap-1.5 text-xs" disabled={!cleaned || duplicate} onClick={add}><Plus className="w-3.5 h-3.5" /> Add template</Button>
            <span className="text-[11px] text-muted-foreground">{duplicate ? 'A template with this name exists already.' : 'Needs a name, the date header, and an amount (or debit / credit) header. Saved with "Save" below.'}</span>
          </div>
        </div>
      )}
    </div>
  );
}
