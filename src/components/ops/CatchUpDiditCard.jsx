import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { Loader2, History, Play } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import InlineError from '@/components/shared/InlineError';

export default function CatchUpDiditCard({ tenantId }) {
  const [days, setDays] = useState(60);
  const [busy, setBusy] = useState(null); // 'dry' | 'run'
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');

  async function go(dry) {
    setBusy(dry ? 'dry' : 'run'); setError(''); setResult(null);
    try {
      const res = await base44.functions.invoke('catchUpDiditDecisions', {
        tenant_id: tenantId, lookback_days: Number(days), dry_run: dry,
      });
      const d = res?.data || res;
      if (d?.error) setError(d.error); else setResult(d);
    } catch (e) {
      setError(e?.response?.data?.error || e?.message || 'Request failed');
    } finally { setBusy(null); }
  }

  return (
    <div className="bg-card border border-border rounded-xl p-4 space-y-3">
      <div className="flex items-center gap-2 text-xs font-semibold text-muted-foreground uppercase tracking-wide">
        <History className="w-3.5 h-3.5" /> Catch up Didit decisions
      </div>
      <div className="text-xs text-muted-foreground">
        Re-checks pending identity verifications on requests created within the look-back window (max 50 per run).
      </div>
      <div className="flex items-center gap-2">
        <label className="text-xs text-muted-foreground">Look back (days)</label>
        <Input type="number" min={1} max={180} value={days} onChange={(e) => setDays(e.target.value)} className="h-8 text-xs w-24" />
        <Button size="sm" variant="outline" className="h-8 text-xs gap-1.5" disabled={!!busy || !(Number(days) > 0)} onClick={() => go(true)}>
          {busy === 'dry' && <Loader2 className="w-3.5 h-3.5 animate-spin" />} Dry run
        </Button>
        <Button size="sm" className="h-8 text-xs gap-1.5" disabled={!!busy || !(Number(days) > 0)} onClick={() => go(false)}>
          {busy === 'run' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />} Run
        </Button>
      </div>
      {error && <InlineError message={error} />}
      {result && (
        <div className="space-y-2">
          <div className="text-xs">
            Scanned {result.scanned} · Candidates {result.candidates} · Processed {result.processed} · Remaining {result.remaining} · Updated {result.updated} · Still pending {result.still_pending} · Errors {Array.isArray(result.errors) ? result.errors.length : result.errors}
          </div>
          <div className="text-xs text-muted-foreground">scan_truncated: {String(!!result.scan_truncated)}</div>
          {!result.dry_run && result.remaining > 0 && (
            <Button size="sm" variant="outline" className="h-8 text-xs gap-1.5" disabled={!!busy} onClick={() => go(false)}>
              <Play className="w-3.5 h-3.5" /> Run again
            </Button>
          )}
          {Array.isArray(result.errors) && result.errors.length > 0 && (
            <ul className="text-xs text-red-700 list-disc pl-4">{result.errors.map((m, i) => <li key={i}>{m}</li>)}</ul>
          )}
          {result.items?.length > 0 && (
            <div className="overflow-x-auto border border-border rounded-lg">
              <table className="w-full text-[11px]">
                <thead><tr className="bg-muted/40 text-muted-foreground text-left">
                  {['Outreach', 'Item', 'Client', 'Session', 'Created', 'Last updated', ...(result.dry_run ? [] : ['Result'])].map((h) => <th key={h} className="px-2 py-1.5">{h}</th>)}
                </tr></thead>
                <tbody className="divide-y divide-border">
                  {result.items.map((r, i) => (
                    <tr key={i}>
                      <td className="px-2 py-1.5 font-mono">{r.outreach_id}</td>
                      <td className="px-2 py-1.5 font-mono">{r.item_id}</td>
                      <td className="px-2 py-1.5 font-mono">{r.client_id || '—'}</td>
                      <td className="px-2 py-1.5 font-mono">{r.session_id}</td>
                      <td className="px-2 py-1.5">{r.created_date ? new Date(r.created_date).toLocaleString() : '—'}</td>
                      <td className="px-2 py-1.5">{r.last_updated ? new Date(r.last_updated).toLocaleString() : '—'}</td>
                      {!result.dry_run && <td className="px-2 py-1.5">{r.outcome}</td>}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}