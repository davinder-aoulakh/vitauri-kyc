import React, { useEffect, useState } from 'react';
import { base44 } from '@/api/base44Client';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { CheckCircle, Circle, KeyRound, Loader2, Webhook } from 'lucide-react';
import { toast } from '@/components/ui/use-toast';

// Didit connection for this tenant (Tenant Admin). Keys go to the server (TenantSecret) and are never shown again:
// only "set · ends with …" and when they were last rotated. Used for ID&V, KYB and transaction monitoring.
export default function DiditConnectionCard({ tenant }) {
  const [status, setStatus] = useState(null);
  const [apiKey, setApiKey] = useState('');
  const [secret, setSecret] = useState('');
  const [busy, setBusy] = useState(null);

  async function loadStatus() {
    try {
      const res = await base44.functions.invoke('diditProxy', { action: 'credential_status', tenant_id: tenant.id });
      setStatus(res?.data || null);
    } catch { setStatus(null); }
  }
  useEffect(() => { if (tenant?.id) loadStatus(); }, [tenant?.id]);

  async function run(kind, fn, okText) {
    setBusy(kind);
    try {
      const res = await fn();
      const data = res?.data || res;
      if (data?.error) throw new Error(data.error);
      toast({ title: okText(data) });
      await loadStatus();
    } catch (e) {
      toast({ variant: 'destructive', title: 'Didit connection', description: e?.response?.data?.error || e?.message });
    } finally {
      setBusy(null);
    }
  }

  const saveKey = () => run('key', () => base44.functions.invoke('diditProxy', { action: 'save_credentials', tenant_id: tenant.id, didit_api_key: apiKey.trim() }), () => { setApiKey(''); return 'Didit API key saved'; });
  const saveSecret = () => run('secret', () => base44.functions.invoke('diditProxy', { action: 'save_webhook_secret', tenant_id: tenant.id, didit_webhook_secret: secret.trim() }), () => { setSecret(''); return 'Webhook signing secret saved'; });
  const register = () => run('register', () => base44.functions.invoke('registerDiditWebhook', { tenant_id: tenant.id, action: 'register' }), (d) => (d?.updated ? 'Webhook destination updated' : 'Webhook registered at Didit'));
  const test = () => run('test', () => base44.functions.invoke('registerDiditWebhook', { tenant_id: tenant.id, action: 'test' }), (d) => (d?.ok ? 'Test event delivered and verified' : `Test failed (HTTP ${d?.status})`));

  const Row = ({ ok, label, detail }) => (
    <div className="flex items-center gap-2 text-xs">
      {ok ? <CheckCircle className="w-3.5 h-3.5 text-emerald-600" /> : <Circle className="w-3.5 h-3.5 text-muted-foreground" />}
      <span className="font-medium">{label}</span>
      <span className="text-muted-foreground">{detail}</span>
    </div>
  );

  return (
    <div className="bg-card border border-border rounded-xl p-4 space-y-4">
      <div>
        <div className="font-semibold text-sm">Didit connection</div>
        <p className="text-xs text-muted-foreground mt-0.5">
          Used for ID verification, business verification (KYB) and transaction monitoring (AML / KYT). Keys are stored on the server only and never shown again.
        </p>
      </div>

      <div className="space-y-1">
        <Row ok={status?.api_key_configured} label="API key" detail={status?.api_key_configured ? `set · ends with …${status.api_key_last4}` : 'not set'} />
        <Row ok={status?.webhook_secret_configured} label="Webhook signing secret" detail={status?.webhook_secret_configured ? 'set' : 'not set'} />
        {status?.last_rotated_at && <div className="text-[11px] text-muted-foreground pl-5">Last rotated {new Date(status.last_rotated_at).toLocaleString()}</div>}
      </div>

      <div className="grid md:grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label className="text-xs">{status?.api_key_configured ? 'Replace API key' : 'API key'}</Label>
          <div className="flex gap-2">
            <Input type="password" autoComplete="off" value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder="x-api-key from the Didit console" className="h-8 text-sm" />
            <Button size="sm" className="h-8 gap-1" disabled={!apiKey.trim() || busy} onClick={saveKey}>
              {busy === 'key' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <KeyRound className="w-3.5 h-3.5" />} Save
            </Button>
          </div>
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">{status?.webhook_secret_configured ? 'Replace webhook secret' : 'Webhook signing secret'}</Label>
          <div className="flex gap-2">
            <Input type="password" autoComplete="off" value={secret} onChange={(e) => setSecret(e.target.value)} placeholder="Signing secret of the webhook destination" className="h-8 text-sm" />
            <Button size="sm" className="h-8" disabled={!secret.trim() || busy} onClick={saveSecret}>
              {busy === 'secret' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : 'Save'}
            </Button>
          </div>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="outline" className="h-8 gap-1.5 text-xs" disabled={!status?.api_key_configured || busy} onClick={register}>
          {busy === 'register' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Webhook className="w-3.5 h-3.5" />} Register webhook at Didit
        </Button>
        <Button size="sm" variant="outline" className="h-8 text-xs" disabled={!status?.webhook_secret_configured || busy} onClick={test}>
          {busy === 'test' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : 'Send test event'}
        </Button>
      </div>
      <p className="text-[11px] text-muted-foreground">
        Registering subscribes Vitauri to session, KYB and transaction events (transaction.created, transaction.status.updated). Every event is verified with X-Signature-V2, must be at most 5 minutes old (signed timestamp) and is processed once per event id.
      </p>
    </div>
  );
}
