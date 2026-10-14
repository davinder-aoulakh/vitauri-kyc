import React, { useState } from 'react';
import KpiCard from '@/components/shared/KpiCard';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { WINDOWS } from '@/lib/tmRules';
import { Loader2, Lightbulb } from 'lucide-react';

function Suggestion({ s }) {
  if (!s) return <p className="text-xs text-muted-foreground">Run a backtest to get one tuning suggestion.</p>;
  if (s.error) return <p className="text-xs text-red-700">{s.error}</p>;
  if (s.insufficient) return <p className="text-xs text-muted-foreground">Not enough data for a suggestion{s.missing?.length ? `: ${s.missing.join('; ')}` : ''}.</p>;
  return (
    <div className="text-sm space-y-1">
      <div className="font-medium">{s.title}</div>
      <div>{s.change}</div>
      {s.expected_effect && <div className="text-xs text-muted-foreground">Expected effect: {s.expected_effect}</div>}
      <div className="text-[11px] text-purple-700">Suggestion only. Edit the rule yourself to apply it.</div>
    </div>
  );
}

export default function BacktestPanel({ backtest, canRun, busy, onRun }) {
  const [days, setDays] = useState('90');
  const period = backtest?.raw?.period_days || 90;
  const known = backtest ? (backtest.known_cases_found == null ? 'n/a' : `${backtest.known_cases_found} of ${backtest.known_cases_total}`) : '—';
  return (
    <div>
      <div className="grid grid-cols-3 gap-3 mb-3">
        <KpiCard label={`Hits ${period} d`} value={backtest?.hits_txn ?? '—'} subtitle={backtest ? `${backtest.hits_customers} customers` : 'No backtest yet'} accent="bg-primary" />
        <KpiCard label="Known cases found" value={known} subtitle={backtest?.raw?.known_note || 'Reported cases caught'} accent="bg-success" />
        <KpiCard label="Est. alerts/mo" value={backtest?.est_alerts_month ?? '—'} subtitle="From the window" accent="bg-warning" />
      </div>
      {canRun && (
        <div className="flex items-center gap-2 mb-3">
          <Select value={days} onValueChange={setDays}>
            <SelectTrigger className="w-40 h-8"><SelectValue /></SelectTrigger>
            <SelectContent>{WINDOWS.map((w) => <SelectItem key={w.days} value={String(w.days)}>{w.label}</SelectItem>)}</SelectContent>
          </Select>
          <Button size="sm" variant="outline" disabled={!!busy} onClick={() => onRun(Number(days))}>
            {busy === 'backtestRule' && <Loader2 className="w-3.5 h-3.5 animate-spin" />} Run backtest
          </Button>
        </div>
      )}
      <div className="rounded-lg border border-purple-200 bg-purple-50 p-3">
        <div className="flex items-center gap-1.5 text-xs font-semibold text-purple-800 mb-1.5"><Lightbulb className="w-3.5 h-3.5" /> AI tuning suggestion</div>
        <Suggestion s={backtest?.raw?.suggestion} />
      </div>
    </div>
  );
}