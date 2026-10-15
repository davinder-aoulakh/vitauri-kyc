import React, { useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/components/ui/use-toast';
import InlineError from '@/components/shared/InlineError';
import FxMissingBadge from '@/components/shared/FxMissingBadge';
import FxRatesTable from '@/components/tenantconfig/tm/FxRatesTable';
import { errorMessage } from '@/lib/tmAlerts';
import { Loader2, Download, History, Upload, RefreshCw } from 'lucide-react';

const call = async (name, payload) => { const res = await base44.functions.invoke(name, payload); return res?.data ?? res; };
const daysAgo = (n) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);

export default function FxRatesCard({ tenantId, canManage }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const key = ['fx-status', tenantId];
  const q = useQuery({ queryKey: key, enabled: !!tenantId, queryFn: () => call('fxRateStatus', {}) });
  const [from, setFrom] = useState(daysAgo(30));
  const [to, setTo] = useState(daysAgo(0));
  const [busy, setBusy] = useState('');
  const fileRef = useRef(null);

  const run = async (id, name, payload, done) => {
    setBusy(id);
    try {
      toast({ title: done(await call(name, payload)) });
      await qc.invalidateQueries({ queryKey: key });
    } catch (e) {
      toast({ title: 'Failed', description: errorMessage(e), variant: 'destructive' });
    } finally { setBusy(''); }
  };
  const onFile = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (file) run('csv', 'fxRateBackfill', { csv_text: await file.text() }, (r) => `${r.rows} rates uploaded`);
  };
  const s = q.data;
  const btn = (id, label, Icon, onClick) => (
    <Button size="sm" variant="outline" className="gap-1.5 text-xs" disabled={!!busy} onClick={onClick}>
      {busy === id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Icon className="h-3.5 w-3.5" />} {label}
    </Button>
  );

  return (
    <div className="bg-card border border-border rounded-xl p-5 space-y-4">
      <div>
        <h3 className="font-semibold text-sm">FX rates</h3>
        <p className="text-xs text-muted-foreground">
          {s?.latest_import ? `Latest import: ${s.latest_import.date} · ${s.latest_import.source}` : 'No rates imported yet.'} Rates are the ECB daily reference rates, shown as 1 unit of the currency in {s?.reporting_currency || 'the reporting currency'}.
        </p>
      </div>
      {q.error && <InlineError message={errorMessage(q.error)} onRetry={q.refetch} />}
      {q.isLoading && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
      {s && <FxMissingBadge count={s.fx_missing} />}
      {s && <FxRatesTable status={s} />}
      {canManage && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-end gap-3">
            <div><Label className="text-[11px] mb-1 block">From</Label><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="h-8 text-xs w-36" /></div>
            <div><Label className="text-[11px] mb-1 block">To</Label><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="h-8 text-xs w-36" /></div>
            <span className="text-[11px] text-muted-foreground pb-2">Range for Backfill (max 120 days) and Recompute.</span>
          </div>
          <div className="flex flex-wrap gap-2">
            {btn('import', 'Import now', Download, () => run('import', 'fxRateImport', {}, (r) => (r.results?.[0]?.skipped ? `No new ECB file (latest ${r.date})` : `Imported rates for ${r.date}`)))}
            {btn('backfill', 'Backfill', History, () => run('backfill', 'fxRateBackfill', { from, to }, (r) => `${r.rows} rates stored for ${r.days} days`))}
            {btn('csv', 'Upload CSV', Upload, () => fileRef.current?.click())}
            {btn('recompute', 'Recompute missing FX', RefreshCw, () => run('recompute', 'recomputeFx', { from, to }, (r) => `${r.updated} transactions updated, ${r.still_missing} still without a rate`))}
            <input ref={fileRef} type="file" accept=".csv,text/csv" className="hidden" onChange={onFile} />
          </div>
          <p className="text-[11px] text-muted-foreground">CSV columns: date, base, quote, rate (for example 2026-10-14, GBP, USD, 1.31).</p>
        </div>
      )}
    </div>
  );
}