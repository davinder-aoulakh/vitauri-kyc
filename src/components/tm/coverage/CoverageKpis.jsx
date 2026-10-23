import React from 'react';
import KpiCard from '@/components/shared/KpiCard';
import { Landmark, CheckCircle, CalendarX, Unplug, Eye, Copy } from 'lucide-react';

const LC_LABEL = { booked: 'booked', reversed: 'reversed', corrected: 'corrected', declined: 'declined', intended: 'intended (API only)' };

export default function CoverageKpis({ kpis, monthLabel, lifecycle }) {
  const lc = lifecycle ? Object.entries(LC_LABEL).filter(([k]) => lifecycle[k] !== null && lifecycle[k] !== undefined) : [];
  return (
    <div className="space-y-2">
    <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3">
      <KpiCard label="Accounts" value={kpis.accounts} icon={Landmark} />
      <KpiCard label="Complete" value={kpis.complete} subtitle="No missing days" icon={CheckCircle} accent="bg-success" />
      <KpiCard label="Missing days" value={kpis.missingAccounts} subtitle="Accounts affected" icon={CalendarX} accent="bg-destructive" />
      <KpiCard label="Stalled connections" value={kpis.stalled} icon={Unplug} accent="bg-warning" />
      <KpiCard label="Unreviewed transactions" value={kpis.unreviewed} subtitle={`In review, ${monthLabel}`} icon={Eye} accent="bg-warning" />
      <KpiCard label="Duplicates removed" value={kpis.duplicates} subtitle={monthLabel} icon={Copy} />
    </div>
    {lc.length > 0 && (
      <p className="text-xs text-muted-foreground" aria-label="Transaction lifecycle">
        Transactions {monthLabel}: {lc.map(([k, label]) => `${lifecycle[k].toLocaleString()} ${label}`).join(' · ')}
      </p>
    )}
    </div>
  );
}