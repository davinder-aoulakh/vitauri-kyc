import React, { useEffect, useState } from 'react';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import InlineError from '@/components/shared/InlineError';
import { Loader2, KeyRound } from 'lucide-react';
import { cn } from '@/lib/utils';

const errMsg = (e) => e?.response?.data?.error || e?.message || 'Something went wrong';
const rows = (p) => (Array.isArray(p) ? p : p?.items || []);
const SRC = { TenantSecret: 'text-emerald-700', 'Tenant (legacy)': 'text-amber-700', missing: 'text-red-600' };
const PROBE = { ok: 'bg-emerald-100 text-emerald-700', auth_error: 'bg-red-100 text-red-700', unreachable: 'bg-amber-100 text-amber-800' };

export default function CredentialsPanel() {
  const [tenants, setTenants] = useState([]);
  const [latest, setLatest] = useState({});
  const [loading, setLoading] = useState(false);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState('');

  const load = async () => {
    setLoading(true); setError('');
    try {
      const [t, checks] = await Promise.all([
        base44.entities.Tenant.list('name', 500),
        base44.entities.DiditEndpointCheck.filter({ kind: 'credentials' }, { sort: '-checked_at', limit: 500 }),
      ]);
      setTenants(rows(t));
      const map = {};
      rows(checks).forEach((c) => { if (!map[c.tenant_id]) map[c.tenant_id] = c; });
      setLatest(map);
    } catch (e) { setError(errMsg(e)); }
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  const run = async () => {
    setRunning(true); setError('');
    try {
      const res = await base44.functions.invoke('diditCredentialSelfTest', { tenant_id: 'all' });
      const failed = (res.data.results || []).filter((r) => r.error);
      if (failed.length) setError(`${failed.length} tenant(s) could not be tested: ${failed.map((f) => f.tenant_name).join(', ')}`);
      await load();
    } catch (e) { setError(errMsg(e)); }
    setRunning(false);
  };

  return (
    <div className="bg-card border border-border rounded-xl overflow-hidden">
      <div className="px-4 py-3 border-b border-border flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="font-semibold text-sm">Credentials</h2>
          <p className="text-xs text-muted-foreground">Where each tenant's Didit key and webhook secret are found, plus one read-only authenticated request to Didit. No key material is shown.</p>
        </div>
        <Button size="sm" onClick={run} disabled={running} className="gap-2">
          {running ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <KeyRound className="w-3.5 h-3.5" />} Run self-test
        </Button>
      </div>
      {error && <div className="p-3"><InlineError message={error} onRetry={load} /></div>}
      {loading && <div className="p-4"><Loader2 className="w-4 h-4 animate-spin text-muted-foreground" /></div>}
      {!loading && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-muted/40 border-b border-border text-xs text-muted-foreground uppercase tracking-wide">
                <th className="text-left px-4 py-2.5">Tenant</th>
                <th className="text-left px-4 py-2.5">API key</th>
                <th className="text-left px-4 py-2.5">Webhook secret</th>
                <th className="text-left px-4 py-2.5">Didit request</th>
                <th className="text-left px-4 py-2.5">Last run</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {tenants.map((t) => {
                const c = latest[t.id]?.credentials;
                return (
                  <tr key={t.id}>
                    <td className="px-4 py-2 text-xs font-medium">{t.name}</td>
                    <td className={cn('px-4 py-2 text-xs', SRC[c?.api_key_source])}>{c ? c.api_key_source : 'not run'}</td>
                    <td className={cn('px-4 py-2 text-xs', SRC[c?.webhook_secret_source])}>{c ? c.webhook_secret_source : 'not run'}</td>
                    <td className="px-4 py-2 text-xs">
                      {c ? <span className={cn('px-2 py-0.5 rounded-full font-medium', PROBE[c.probe])} title={c.note || ''}>{c.probe}{c.http_status ? ` (${c.http_status})` : ''}</span> : <span className="text-muted-foreground">n/a</span>}
                    </td>
                    <td className="px-4 py-2 text-xs text-muted-foreground">{latest[t.id]?.checked_at ? new Date(latest[t.id].checked_at).toLocaleString() : ''}</td>
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