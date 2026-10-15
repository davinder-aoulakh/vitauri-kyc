import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import InlineError from '@/components/shared/InlineError';
import { Button } from '@/components/ui/button';
import { formatDistanceToNow } from 'date-fns';
import { Activity, FlaskConical, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

const ago = (iso) => (iso ? `${formatDistanceToNow(new Date(iso))} ago` : '—');

export default function TmHealthCard() {
  const navigate = useNavigate();
  const [rows, setRows] = useState(null);
  const [error, setError] = useState('');

  async function load() {
    setError('');
    try {
      const res = await base44.functions.invoke('tmHealth', {});
      setRows(res.data.tenants);
    } catch (e) { setError(e?.response?.data?.error || e?.message || 'Could not load TM health'); }
  }
  useEffect(() => { load(); }, []);

  return (
    <div className="bg-card border border-border rounded-xl overflow-hidden mb-6">
      <div className="px-4 py-3 border-b border-border flex items-center justify-between">
        <h2 className="font-semibold text-sm flex items-center gap-2"><Activity className="w-4 h-4 text-primary" /> TM health</h2>
        <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={() => navigate('/ops/tm-regression')}>
          <FlaskConical className="w-3 h-3" /> Regression harness
        </Button>
      </div>
      {error && <div className="p-4"><InlineError message={error} onRetry={load} /></div>}
      {!rows && !error && <div className="p-6 flex justify-center"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>}
      {rows && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-muted/40 border-b border-border text-xs text-muted-foreground uppercase tracking-wide">
                <th className="text-left px-4 py-2.5">Tenant</th>
                <th className="text-left px-4 py-2.5">tm_core</th>
                <th className="text-left px-4 py-2.5">TM flags on</th>
                <th className="text-left px-4 py-2.5">Last coverage run</th>
                <th className="text-left px-4 py-2.5">Last webhook</th>
                <th className="text-left px-4 py-2.5">Failed Didit submissions (24h)</th>
                <th className="text-left px-4 py-2.5">Rules in drift</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.map((r) => {
                const flagList = Object.entries(r.flags || {});
                const onCount = flagList.filter(([, v]) => v).length;
                return (
                  <tr key={r.tenant_id} className="hover:bg-muted/20">
                    <td className="px-4 py-2 text-xs font-medium">{r.name}</td>
                    {r.error ? <td colSpan={6} className="px-4 py-2 text-xs text-red-600">{r.error}</td> : (
                      <>
                        <td className="px-4 py-2">
                          <span className={cn('text-xs px-2 py-0.5 rounded-full font-medium', r.flags.tm_core ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-600')}>{r.flags.tm_core ? 'On' : 'Off'}</span>
                        </td>
                        <td className="px-4 py-2 text-xs" title={flagList.map(([k, v]) => `${k}: ${v ? 'on' : 'off'}`).join('\n')}>{onCount} / {flagList.length}</td>
                        <td className="px-4 py-2 text-xs text-muted-foreground">{r.flags.tm_core ? ago(r.last_coverage_run) : '—'}</td>
                        <td className="px-4 py-2 text-xs text-muted-foreground">{ago(r.last_webhook)}</td>
                        <td className={cn('px-4 py-2 text-xs tabular-nums font-medium', r.failed_submissions_24h > 0 && 'text-red-600')}>{r.failed_submissions_24h}</td>
                        <td className={cn('px-4 py-2 text-xs tabular-nums font-medium', r.rules_in_drift > 0 && 'text-amber-600')}>{r.rules_in_drift}</td>
                      </>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}