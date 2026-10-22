import React, { useState } from 'react';
import FieldRow from '@/components/tm/report/FieldRow';
import { Button } from '@/components/ui/button';
import { ChevronDown, ChevronRight, RefreshCw } from 'lucide-react';

const SECTIONS = [
  { key: 'reporting', title: 'Reporting entity' },
  { key: 'report', title: 'Report' },
  { key: 'subject', title: 'Subject' },
  { key: 'ownership', title: 'Ownership & control (ORG)' },
  { key: 'accounts', title: 'Accounts' },
  { key: 'transactions', title: 'Transactions', collapsible: true },
  { key: 'counterparties', title: 'Counterparties' },
  { key: 'other', title: 'Other' },
];

function sectionOf(path) {
  const p = String(path || '');
  if (p.startsWith('reporting_entity.')) return 'reporting';
  if (p.startsWith('report.') || p === 'narrative') return 'report';
  if (p.startsWith('director_id') || p.startsWith('related_party')) return 'ownership';
  if (p.startsWith('t_person.') || p.startsWith('t_entity.')) return 'subject';
  if (p.startsWith('transaction') ) return 'transactions';
  if (p.startsWith('counterparty')) return 'counterparties';
  if (/account/.test(p) || p.startsWith('t_from_my_client.') || p.startsWith('t_to_my_client.')) return 'accounts';
  return 'other';
}

function Head({ title, children, onClick, open, collapsible }) {
  return (
    <tr className="bg-muted/40 border-b border-border">
      <td colSpan={3} className="px-3 py-2">
        <button type="button" disabled={!collapsible} onClick={onClick} className="flex w-full items-center gap-1.5 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground disabled:cursor-default">
          {collapsible && (open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />)}
          {title}
          {children}
        </button>
      </td>
    </tr>
  );
}

export default function FieldsTable({ report, editable, editing, busy, onSave, canRefresh, onRefresh }) {
  const [txOpen, setTxOpen] = useState(false);
  const missing = (report.missing_fields || []).map((p) => ({ path: p, label: p, value: '' }));
  const rows = [...missing.map((f) => ({ f, m: true })), ...(report.fields || []).map((f) => ({ f, m: false }))];
  const groups = Object.fromEntries(SECTIONS.map((s) => [s.key, []]));
  rows.forEach((r) => groups[sectionOf(r.f.path)].push(r));
  const value = (path) => (report.fields || []).find((f) => f.path === path);
  const txMissing = groups.transactions.some((r) => r.m);

  return (
    <section className="bg-card border border-border rounded-xl overflow-hidden">
      <div className="flex items-center justify-between gap-2 px-4 py-3 border-b border-border">
        <h2 className="text-sm font-semibold">Report content</h2>
        {canRefresh && (
          <Button size="sm" variant="outline" className="h-7 gap-1.5 text-xs" disabled={busy} onClick={onRefresh} title="Re-run the field mapping from the customer file. Fields you edited are kept.">
            <RefreshCw className="h-3 w-3" /> Refresh fields from file
          </Button>
        )}
      </div>
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-[11px] uppercase tracking-wider text-muted-foreground border-b border-border">
            <th className="px-3 py-2 font-semibold">Field</th><th className="px-3 py-2 font-semibold">Value</th><th className="px-3 py-2 font-semibold">Source</th>
          </tr>
        </thead>
        <tbody>
          {SECTIONS.filter((s) => groups[s.key].length).map((s) => {
            const isTx = s.key === 'transactions';
            const open = !isTx || txOpen || txMissing;
            const count = value('transactions.count');
            const tin = value('transactions.total_in');
            const tout = value('transactions.total_out');
            return (
              <React.Fragment key={s.key}>
                <Head title={s.title} collapsible={isTx} open={open} onClick={() => setTxOpen((o) => !o)}>
                  {isTx && (
                    <span className="ml-2 font-normal normal-case tracking-normal">
                      {count ? `${count.value} transaction(s)` : ''}
                      {tin ? ` · ${tin.label}: ${tin.value}` : ''}
                      {tout ? ` · ${tout.label}: ${tout.value}` : ''}
                      {txMissing ? ' · required fields missing' : ''}
                    </span>
                  )}
                </Head>
                {open && groups[s.key].map(({ f, m }) => <FieldRow key={`${f.path}-${f.value}`} field={f} missing={m} editable={editable} editing={editing} busy={busy} onSave={onSave} />)}
              </React.Fragment>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}
