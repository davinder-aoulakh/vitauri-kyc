import React, { useEffect, useState } from 'react';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import InlineError from '@/components/shared/InlineError';
import { Loader2, Radar } from 'lucide-react';
import { cn } from '@/lib/utils';

const BADGE = {
  ok: 'bg-emerald-100 text-emerald-700',
  reachable: 'bg-blue-100 text-blue-700',
  missing: 'bg-red-100 text-red-700',
  auth: 'bg-amber-100 text-amber-800',
  error: 'bg-red-100 text-red-700',
  skipped: 'bg-muted text-muted-foreground',
};

const errMsg = (e) => e?.response?.data?.error || e?.message || 'Something went wrong';

export default function EndpointCheckPanel({ tenantId }) {
  const [check, setCheck] = useState(null);
  const [loading, setLoading] = useState(false);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState('');

  const load = async () => {
    setLoading(true); setError('');
    try {
      const page = await base44.entities.DiditEndpointCheck.filter({ tenant_id: tenantId }, { sort: '-checked_at', limit: 1 });
      setCheck((page.items || page)[0] || null);
    } catch (e) { setError(errMsg(e)); }
    setLoading(false);
  };
  useEffect(() => { setCheck(null); load(); }, [tenantId]);

  const run = async () => {
    setRunning(true); setError('');
    try {
      const res = await base44.functions.invoke('diditEndpointCheck', { tenant_id: tenantId });
      setCheck(res.data.check);
    } catch (e) { setError(errMsg(e)); }
    setRunning(false);
  };

  return (
    <div className="bg-card border border-border rounded-xl overflow-hidden">
      <div className="px-4 py-3 border-b border-border flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="font-semibold text-sm">Didit endpoint check</h2>
          <p className="text-xs text-muted-foreground">
            {check?.checked_at ? `Last run ${new Date(check.checked_at).toLocaleString()}` : 'Not run yet'}. Read-only probes; no FIU report or case is created.
          </p>
        </div>
        <Button size="sm" onClick={run} disabled={running} className="gap-2">
          {running ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Radar className="w-3.5 h-3.5" />} Run check
        </Button>
      </div>
      {error && <div className="p-3"><InlineError message={error} onRetry={load} /></div>}
      {loading && <div className="p-4"><Loader2 className="w-4 h-4 animate-spin text-muted-foreground" /></div>}
      {check?.results?.length > 0 && (
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-muted/40 border-b border-border text-xs text-muted-foreground uppercase tracking-wide">
              <th className="text-left px-4 py-2.5">Endpoint</th>
              <th className="text-left px-4 py-2.5">Method</th>
              <th className="text-left px-4 py-2.5">Path</th>
              <th className="text-left px-4 py-2.5">Status</th>
              <th className="text-left px-4 py-2.5">Result</th>
              <th className="text-left px-4 py-2.5">Note</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {check.results.map((r) => (
              <tr key={r.name}>
                <td className="px-4 py-1.5 text-xs font-medium">{r.name}</td>
                <td className="px-4 py-1.5 text-xs font-mono">{r.method}</td>
                <td className="px-4 py-1.5 text-xs font-mono break-all">{r.path}</td>
                <td className="px-4 py-1.5 text-xs">{r.status || '—'}</td>
                <td className="px-4 py-1.5"><span className={cn('text-xs px-2 py-0.5 rounded-full font-medium', BADGE[r.classification])}>{r.classification}</span></td>
                <td className="px-4 py-1.5 text-xs text-muted-foreground">{r.note}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}