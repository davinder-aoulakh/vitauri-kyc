import React from 'react';
import KpiCard from '@/components/shared/KpiCard';

const compact = (n) => (n == null ? '—' : Number(n).toLocaleString('en-US', { notation: 'compact', maximumFractionDigits: 1 }));

export default function AnalysisKpis({ analysis }) {
  const gaps = analysis.integrity?.gap_count ?? 0;
  const reconciles = analysis.integrity?.reconciles !== false;
  const clean = reconciles && gaps === 0;
  const cur = analysis.currency || '';
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
      <KpiCard label="Source" value={analysis.statement_upload_ids?.length ?? 0} subtitle="Bank statements" accent="bg-primary" />
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
    </div>
  );
}