import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import KpiCard from '@/components/shared/KpiCard';
import SourceChips from '@/components/tm/kit/SourceChips';

const list = (r) => (Array.isArray(r) ? r : r?.items || []);

const compact = (n) => (n == null ? '—' : Number(n).toLocaleString('en-US', { notation: 'compact', maximumFractionDigits: 1 }));

export default function AnalysisKpis({ analysis, uploads = [] }) {
  // Source: which bank(s) the analysed statements come from (mock-up: "MCB · 6 PDF statements").
  const used = uploads.filter((u) => (analysis.statement_upload_ids || []).includes(u.id));
  const accountIds = [...new Set(used.map((u) => u.bank_account_id).filter(Boolean))];
  const { data: banks = [] } = useQuery({
    queryKey: ['analysis-banks', accountIds.join(',')],
    enabled: accountIds.length > 0,
    staleTime: 300000,
    queryFn: async () => list(await base44.entities.BankAccount.filter({ id: { $in: accountIds } }, undefined, accountIds.length)).map((a) => a.institution).filter(Boolean),
  });
  const formats = [...new Set(used.map((u) => String(u.format || '').toUpperCase()).filter(Boolean))].join('/');
  const sourceText = [[...new Set(banks)].join(', '), `${analysis.statement_upload_ids?.length ?? 0}${formats ? ` ${formats}` : ''} statement${(analysis.statement_upload_ids?.length ?? 0) === 1 ? '' : 's'}`].filter(Boolean).join(' · ');
  const gaps = analysis.integrity?.gap_count ?? 0;
  const reconciles = analysis.integrity?.reconciles !== false;
  const clean = reconciles && gaps === 0;
  const cur = analysis.currency || '';
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
      <KpiCard label="Source" value={[...new Set(banks)][0] || (analysis.statement_upload_ids?.length ?? 0)} subtitle={sourceText} accent="bg-primary" />
      <KpiCard label="Transactions" value={analysis.txn_count} subtitle={`${analysis.period_from} to ${analysis.period_to}`} accent="bg-primary" />
      <KpiCard label="Avg inbound / mo" value={compact(analysis.avg_inbound_month)} subtitle={cur} accent="bg-success" />
      <KpiCard label="Avg outbound / mo" value={compact(analysis.avg_outbound_month)} subtitle={cur} accent="bg-warning" />
      <KpiCard
        label="Integrity" value={clean ? 'Clean' : `${gaps} gap${gaps === 1 ? '' : 's'}`}
        subtitle={reconciles ? 'Reconciles' : 'Does not reconcile'} accent={clean ? 'bg-success' : 'bg-destructive'}
      />
      <KpiCard
        label="Risk indicators" value={analysis.risk_indicators?.length ?? 0}
        subtitle={analysis.consistency_with_occupation ? `Occupation: ${analysis.consistency_with_occupation}` : undefined}
        accent={(analysis.risk_indicators?.length || 0) > 0 ? 'bg-warning' : 'bg-success'}
      />
      {(analysis.risk_indicators || []).length > 0 && (
        <ul className="col-span-full space-y-1 rounded-lg border border-amber-200 bg-amber-50/60 p-3 text-xs dark:border-amber-500/30 dark:bg-amber-500/10">
          {analysis.risk_indicators.map((r, i) => (
            <li key={r.code || i} className="flex flex-wrap items-center gap-1.5">
              <span className="font-semibold">!</span>
              <span>{r.label || r.code}</span>
              {r.severity && <span className="text-muted-foreground">({r.severity})</span>}
              {r.source_refs?.length > 0 && <SourceChips refs={r.source_refs} max={3} />}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}