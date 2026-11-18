import React, { useEffect, useState } from 'react';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { toast } from '@/components/ui/use-toast';
import { AlertTriangle, Building2, KeyRound, Loader2, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { format } from 'date-fns';

const MODES = [['off', 'Off', 'Didit for every country'], ['test', 'Test', 'KvK public test environment; fictitious companies'], ['live', 'Live', 'KvK with the tenant\'s own key']];

/**
 * Ops console: company registry of the guided conversation outreach for one tenant. Didit by default; KvK for Dutch
 * organisations when the mode is Test or Live. The KvK key is write-only here (last 4 characters shown) and is stored in
 * TenantSecret through manageOutreachConfig (Vitauri Ops only). The calls behind "Test connection" and "Try a lookup"
 * arrive with the KvK adapter (outreach phase 6).
 */
export default function OutreachIntegrationsPanel({ tenant, onClose }) {
  const [st, setSt] = useState(/** @type {any} */ (null));
  const [mode, setMode] = useState('off');
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);
  const call = (payload) => base44.functions.invoke('manageOutreachConfig', { tenant_id: tenant.id, ...payload }).then((r) => { if (r?.data?.error) throw new Error(r.data.error); return r.data; });

  useEffect(() => {
    call({ action: 'integration_status' }).then((d) => { setSt(d); setMode(d.kvk_mode || 'off'); })
      .catch((e) => setSt({ error: e?.response?.data?.error || e?.message }));
  }, [tenant.id]);

  async function save(payload, okText) {
    setBusy(true);
    try {
      const d = await call({ action: 'set_integration', ...payload });
      setSt((s) => ({ ...s, ...d })); setMode(d.kvk_mode || 'off'); setKey('');
      toast({ title: okText });
    } catch (e) {
      toast({ variant: 'destructive', title: 'Not saved', description: e?.response?.data?.error || e?.message });
    } finally { setBusy(false); }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-end">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative flex h-full w-full max-w-md flex-col border-l border-border bg-card shadow-2xl">
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <div className="flex items-center gap-2.5">
            <Building2 className="h-5 w-5 text-primary" />
            <div><div className="text-sm font-semibold">Outreach integrations</div><div className="max-w-[240px] truncate text-xs text-muted-foreground">{tenant.name}</div></div>
          </div>
          <Button size="icon" variant="ghost" aria-label="Close" onClick={onClose}><X className="h-4 w-4" /></Button>
        </div>
        <div className="flex-1 space-y-5 overflow-y-auto p-5 text-sm">
          {!st ? <Loader2 className="mx-auto h-5 w-5 animate-spin text-muted-foreground" /> : st.error ? (
            <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-800">{st.error}</div>
          ) : (<>
            {!st.flag_on && <div className="rounded-lg border border-border bg-muted/40 p-3 text-xs">Guided conversation outreach is off for this tenant (Features). Settings saved here apply once it is switched on.</div>}
            {st.kvk_mode === 'test' && (
              <div className="flex gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900">
                <AlertTriangle className="h-4 w-4 flex-shrink-0" /> This tenant is in KvK Test mode: organisation conversations use fictitious KvK test companies. Switch back to Off or Live before real use.
              </div>
            )}
            <div className="space-y-1">
              <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Company registry in use</div>
              <div className="font-medium">{st.registry}</div>
              <div className="text-xs text-muted-foreground">ID&amp;V of persons always uses Didit. Didit key for this tenant: {st.didit_key_set ? 'set' : 'not set'}.</div>
            </div>
            <div className="space-y-2">
              <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">KvK mode (Netherlands)</div>
              <div className="space-y-1.5">
                {MODES.map(([k, l, d]) => {
                  const disabled = k === 'live' && !st.kvk_key_set;
                  return (
                    <label key={k} className={cn('flex cursor-pointer items-start gap-2 rounded-lg border p-2.5', mode === k ? 'border-primary bg-primary/5' : 'border-border', disabled && 'cursor-not-allowed opacity-50')}>
                      <input type="radio" name="kvk_mode" className="mt-1" checked={mode === k} disabled={disabled} onChange={() => setMode(k)} />
                      <span><span className="font-medium">{l}</span><span className="block text-xs text-muted-foreground">{d}{disabled ? ' — save a KvK key first' : ''}</span></span>
                    </label>
                  );
                })}
              </div>
              <Button size="sm" disabled={busy || mode === st.kvk_mode} onClick={() => save({ kvk_mode: mode }, `KvK mode set to ${mode}`)}>
                {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null} Save mode
              </Button>
              <p className="text-[11px] text-muted-foreground">A mode change applies to new requests only; requests already sent keep their mode.</p>
            </div>
            <div className="space-y-2">
              <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">KvK API key</div>
              <div className="flex items-center gap-2 text-xs"><KeyRound className="h-3.5 w-3.5" /> {st.kvk_key_set ? <>Set, ending in <span className="font-mono">{st.kvk_key_last4}</span></> : 'Not set'}
                {st.changed_at && <span className="text-muted-foreground">· changed {format(new Date(st.changed_at), 'd MMM yyyy HH:mm')}</span>}
              </div>
              <Input type="password" autoComplete="off" placeholder={st.kvk_key_set ? 'Enter a new key to replace it' : 'KvK API key of this tenant'} value={key} onChange={(e) => setKey(e.target.value)} />
              <div className="flex gap-2">
                <Button size="sm" variant="outline" disabled={busy || !key.trim()} onClick={() => save({ kvk_api_key: key.trim() }, 'KvK key saved')}>Save key</Button>
                {st.kvk_key_set && <Button size="sm" variant="ghost" className="text-red-700" disabled={busy} onClick={() => save({ kvk_api_key: '' }, 'KvK key removed')}>Remove key</Button>}
              </div>
              <p className="text-[11px] text-muted-foreground">One key per tenant (KvK allows a key within one organisation only). The key is never shown again and every change is audited without the value.</p>
            </div>
            <div className="space-y-2">
              <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Checks</div>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" disabled title="Available with the KvK adapter (outreach phase 6)">Test connection</Button>
                <Button size="sm" variant="outline" disabled title="Available with the KvK adapter (outreach phase 6)">Try a lookup</Button>
              </div>
              <p className="text-[11px] text-muted-foreground">Available with the KvK adapter (outreach phase 6), together with the list of recent registry calls.</p>
            </div>
          </>)}
        </div>
      </div>
    </div>
  );
}
