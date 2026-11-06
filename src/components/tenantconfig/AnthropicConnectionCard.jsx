import React, { useEffect, useState } from 'react';
import { base44 } from '@/api/base44Client';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { CheckCircle, Circle, KeyRound, Loader2, Trash2, PlugZap } from 'lucide-react';
import { toast } from '@/components/ui/use-toast';

const MODELS = [
  ['claude-opus-5-5', 'Claude Opus 5.5 (recommended)'],
  ['claude-sonnet-5-5', 'Claude Sonnet 5.5 (faster, lower cost)'],
  ['claude-fable-5-1', 'Claude Fable 5.1 (most capable, highest cost)'],
];

// Claude (Anthropic) connection for this tenant (Tenant Admin). Used by the KYC Screener on the client profile.
// The key is checked live, stored on the server (TenantSecret) and never shown again: only "set · ends with …".
export default function AnthropicConnectionCard({ tenant }) {
  const [status, setStatus] = useState(null);
  const [apiKey, setApiKey] = useState('');
  const [busy, setBusy] = useState(null);

  async function call(action, extra = {}) {
    const res = await base44.functions.invoke('anthropicConnection', { action, tenant_id: tenant.id, ...extra });
    const data = res?.data || res;
    if (data?.error) throw new Error(data.error);
    return data;
  }
  async function loadStatus() {
    try { setStatus(await call('status')); } catch { setStatus(null); }
  }
  useEffect(() => { if (tenant?.id) loadStatus(); }, [tenant?.id]);

  async function run(kind, fn) {
    setBusy(kind);
    try { await fn(); await loadStatus(); } catch (e) {
      toast({ variant: 'destructive', title: 'Claude connection', description: e?.response?.data?.error || e?.message });
    } finally { setBusy(null); }
  }

  const save = () => run('key', async () => {
    const d = await call('save_key', { api_key: apiKey.trim(), model: status?.model });
    setApiKey('');
    toast({ title: 'Anthropic API key saved', description: `Checked with ${d.model_name || d.model}.` });
  });
  const test = () => run('test', async () => {
    const d = await call('test', { model: status?.model });
    toast(d.ok ? { title: 'Connection works', description: `${d.display_name || d.model} is available for this key.` } : { variant: 'destructive', title: 'Connection failed', description: d.error });
  });
  const remove = () => run('remove', async () => { await call('remove_key'); toast({ title: 'Anthropic API key removed' }); });
  const setModel = (model) => run('model', async () => { await call('set_model', { model }); toast({ title: 'Model updated', description: model }); });

  const configured = status?.configured;
  const sourceText = status?.source === 'tenant' ? `set · ends with …${status.last4}` : status?.source === 'platform' ? 'using the platform key (no tenant key set)' : 'not set';

  return (
    <div className="bg-card border border-border rounded-xl p-4 space-y-4">
      <div>
        <div className="font-semibold text-sm">Claude (Anthropic) connection</div>
        <p className="text-xs text-muted-foreground mt-0.5">
          Used by the KYC Screener on the client profile. Client documents and profile data are sent to Anthropic when a user runs it.
          The key is checked, stored on the server only and never shown again.
        </p>
      </div>

      <div className="space-y-1">
        <div className="flex items-center gap-2 text-xs">
          {configured ? <CheckCircle className="w-3.5 h-3.5 text-emerald-600" /> : <Circle className="w-3.5 h-3.5 text-muted-foreground" />}
          <span className="font-medium">API key</span>
          <span className="text-muted-foreground">{status ? sourceText : 'loading…'}</span>
        </div>
        {status?.rotated_at && status?.source === 'tenant' && <div className="text-[11px] text-muted-foreground pl-5">Last set {new Date(status.rotated_at).toLocaleString()}</div>}
      </div>

      <div className="grid md:grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label className="text-xs" htmlFor="anthropic-key">{status?.source === 'tenant' ? 'Replace API key' : 'API key'}</Label>
          <div className="flex gap-2">
            <Input id="anthropic-key" type="password" autoComplete="off" value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder="sk-ant-… from console.anthropic.com" className="h-8 text-sm" />
            <Button size="sm" className="h-8 gap-1" disabled={!apiKey.trim() || !!busy} onClick={save}>
              {busy === 'key' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <KeyRound className="w-3.5 h-3.5" />} Save
            </Button>
          </div>
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Model</Label>
          <Select value={status?.model || 'claude-opus-5-5'} onValueChange={setModel} disabled={!!busy || !status}>
            <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
            <SelectContent>{MODELS.map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}</SelectContent>
          </Select>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="outline" className="h-8 gap-1.5 text-xs" disabled={!configured || !!busy} onClick={test}>
          {busy === 'test' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <PlugZap className="w-3.5 h-3.5" />} Test connection
        </Button>
        {status?.source === 'tenant' && (
          <Button size="sm" variant="outline" className="h-8 gap-1.5 text-xs text-destructive border-destructive/30" disabled={!!busy} onClick={remove}>
            {busy === 'remove' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />} Remove key
          </Button>
        )}
      </div>
      <p className="text-[11px] text-muted-foreground">Create the key in the Anthropic Console (Settings → API keys), ideally in a workspace for this tenant so usage and spend limits stay separate. Saving, replacing and removing the key are written to the audit log (without the key).</p>
    </div>
  );
}
