import React, { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/components/ui/use-toast';
import KpiCard from '@/components/shared/KpiCard';
import InlineError from '@/components/shared/InlineError';
import FiuReportsTable from '@/components/mi/FiuReportsTable';
import { AlertsPerWeekChart, CoverageChart } from '@/components/mi/TmMiCharts';
import { errorMessage } from '@/lib/tmAlerts';
import { monthOptions, loadMonth, computeKpis, alertsByWeek, coverageByWeek, buildSupervisorCsv, downloadText } from '@/lib/tmMi';
import { Download, Loader2, Bell, Percent, Clock, Timer, FileText, FileSearch } from 'lucide-react';

const Card = ({ title, children }) => (
  <div className="bg-card border border-border rounded-xl p-4">
    <div className="text-sm font-semibold mb-3">{title}</div>
    {children}
  </div>
);

export default function TmMiTab({ tenantId }) {
  const months = useMemo(monthOptions, []);
  const [month, setMonth] = useState(months[0].value);
  const [exporting, setExporting] = useState(false);
  const { toast } = useToast();
  const q = useQuery({ queryKey: ['tmMi', tenantId, month], enabled: !!tenantId, queryFn: () => loadMonth(tenantId, month), staleTime: 60000 });
  const d = q.data;
  const k = useMemo(() => (d ? computeKpis(d.alerts, d.reports) : null), [d]);
  const weekly = useMemo(() => (d ? alertsByWeek(d.alerts, d.scenarios) : { data: [], codes: [] }), [d]);
  const coverage = useMemo(() => (d ? coverageByWeek(d.coverage) : []), [d]);

  const exportCsv = async () => {
    setExporting(true);
    try {
      const { csv, truncated } = await buildSupervisorCsv(tenantId);
      downloadText(`tm-supervisor-export_${new Date().toISOString().slice(0, 10)}.csv`, csv);
      if (truncated) toast({ title: 'Export capped', description: 'Very large history: only the most recent 20,000 records per type were included.' });
    } catch (e) {
      toast({ title: 'Export failed', description: errorMessage(e), variant: 'destructive' });
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Select value={month} onValueChange={setMonth}>
          <SelectTrigger className="h-8 w-44 text-xs" aria-label="Month"><SelectValue /></SelectTrigger>
          <SelectContent>{months.map((m) => <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>)}</SelectContent>
        </Select>
        <Button size="sm" variant="outline" className="gap-1.5 text-xs" disabled={exporting} onClick={exportCsv} title="Exports all alerts, cases and reports, not only the selected month">
          {exporting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />} Export for supervisor
        </Button>
      </div>

      {q.error && <InlineError message="Couldn't load transaction monitoring data." onRetry={() => q.refetch()} />}
      {q.isLoading && <div className="flex justify-center py-10" role="status"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>}
      {k && (
        <>
          {d.truncated && <p className="text-xs text-amber-700">This month has more records than can be shown; figures cover the first 5,000 per type.</p>}
          <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
            <KpiCard label="Alerts" value={k.alerts} icon={Bell} accent="bg-primary" />
            <KpiCard label="False positive rate" value={k.fpRate == null ? '—' : `${k.fpRate}%`} icon={Percent} accent="bg-warning" />
            <KpiCard label="Deadlines missed" value={k.missed} icon={Clock} accent="bg-destructive" />
            <KpiCard label="Avg handling time" value={k.avgHours == null ? '—' : `${k.avgHours} h`} icon={Timer} accent="bg-success" />
            <KpiCard label="Objective reports" value={k.objective} icon={FileText} accent="bg-primary" />
            <KpiCard label="Subjective reports" value={k.subjective} icon={FileSearch} accent="bg-primary" />
          </div>
          <Card title="FIU reports"><FiuReportsTable reports={d.reports} /></Card>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            <Card title="Alerts per week by scenario"><AlertsPerWeekChart data={weekly.data} codes={weekly.codes} /></Card>
            <Card title="Coverage % by week"><CoverageChart data={coverage} /></Card>
          </div>
        </>
      )}
    </div>
  );
}