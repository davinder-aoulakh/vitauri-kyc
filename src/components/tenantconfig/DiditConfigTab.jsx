import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { Loader2, Save, CheckCircle2, XCircle, Wifi, ShieldCheck, ShieldAlert, Copy, Send } from 'lucide-react';

const WEBHOOK_URL = 'https://vitauri-kyc.base44.app/functions/diditWebhook';

export default function DiditConfigTab({ tenant, onSave }) {
  const [apiKey,     setApiKey]     = useState(tenant?.didit_api_key      || '');
  const [workflowId, setWorkflowId] = useState(tenant?.didit_workflow_id  || '');
  const [minScore,   setMinScore]   = useState(tenant?.didit_min_match_score ?? 80);
  const [testing,    setTesting]    = useState(false);
  const [testResult, setTestResult] = useState(null); // null | 'ok' | 'fail'
  const [saving,     setSaving]     = useState(false);

  const [webhookSecret, setWebhookSecret]   = useState(tenant?.didit_webhook_secret || '');
  const [registering,   setRegistering]     = useState(false);
  const [testingHook,   setTestingHook]     = useState(false);
  const [savingSecret,  setSavingSecret]    = useState(false);
  const [hookMsg,       setHookMsg]         = useState(null); // { type: 'ok'|'fail', text }

  async function handleRegisterWebhook() {
    if (!tenant?.id) return;
    setRegistering(true);
    setHookMsg(null);
    try {
      const res = await base44.functions.invoke('registerDiditWebhook', { tenant_id: tenant.id, action: 'register' });
      const data = res?.data || res;
      if (data?.error) {
        setHookMsg({ type: 'fail', text: data.error });
      } else {
        setHookMsg({ type: 'ok', text: data?.updated ? 'Webhook destination updated.' : 'Webhook registered — secret saved.' });
        onSave?.();
      }
    } catch (err) {
      setHookMsg({ type: 'fail', text: err.message || 'Registration failed' });
    } finally {
      setRegistering(false);
    }
  }

  async function handleTestWebhook() {
    if (!tenant?.id) return;
    setTestingHook(true);
    setHookMsg(null);
    try {
      const res = await base44.functions.invoke('registerDiditWebhook', { tenant_id: tenant.id, action: 'test' });
      const data = res?.data || res;
      if (data?.ok) {
        setHookMsg({ type: 'ok', text: 'Test event delivered and verified successfully.' });
      } else {
        setHookMsg({ type: 'fail', text: data?.error || data?.result?.error || 'Test event failed verification.' });
      }
    } catch (err) {
      setHookMsg({ type: 'fail', text: err.message || 'Test failed' });
    } finally {
      setTestingHook(false);
    }
  }

  async function handleSaveSecret() {
    if (!tenant?.id) return;
    setSavingSecret(true);
    await base44.entities.Tenant.update(tenant.id, { didit_webhook_secret: webhookSecret });
    setSavingSecret(false);
    onSave?.();
  }

  async function handleTest() {
    setTesting(true);
    setTestResult(null);
    try {
      const result = await base44.functions.invoke('createDiditSession', {
        _test_only: true,
        api_key: apiKey,
        workflow_id: workflowId,
      });
      setTestResult(result?.data?.error ? 'fail' : 'ok');
    } catch {
      setTestResult('fail');
    } finally {
      setTesting(false);
    }
  }

  async function handleSave() {
    if (!tenant?.id) return;
    setSaving(true);
    await base44.entities.Tenant.update(tenant.id, {
      didit_api_key:          apiKey,
      didit_workflow_id:      workflowId,
      didit_min_match_score:  minScore,
    });
    setSaving(false);
    onSave?.();
  }

  return (
    <div className="bg-card border border-border rounded-xl p-5 space-y-6 max-w-2xl">
      {/* Header */}
      <div>
        <h3 className="font-semibold text-sm flex items-center gap-2">
          🪪 Didit Identity Verification
        </h3>
        <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
          Powered by{' '}
          <a href="https://didit.me" target="_blank" rel="noopener noreferrer"
            className="text-primary underline">Didit (didit.me)</a>
          {' '}— Government-validated, sub-2s inference, 14,000+ document types,
          $0.30/check with 500 free checks/month.
        </p>
      </div>

      {/* API Key */}
      <div className="space-y-1.5">
        <Label className="text-xs font-medium">API Key</Label>
        <Input
          type="password"
          value={apiKey}
          onChange={e => setApiKey(e.target.value)}
          placeholder="ddt_live_xxxxxxxxxxxxxxxx"
          className="h-9 text-sm font-mono"
        />
        <p className="text-xs text-muted-foreground">
          From Didit Console → API Keys. Keep this secret. This key also powers
          PEP/Sanctions/Adverse Media screening (Screening step and Batch
          Screening) via Didit's standalone AML API — no separate key needed.
        </p>
      </div>

      {/* Workflow ID */}
      <div className="space-y-1.5">
        <Label className="text-xs font-medium">KYC Workflow ID</Label>
        <Input
          value={workflowId}
          onChange={e => setWorkflowId(e.target.value)}
          placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
          className="h-9 text-sm font-mono"
        />
        <p className="text-xs text-muted-foreground">
          Configure at{' '}
          <a href="https://business.didit.me" target="_blank" rel="noopener noreferrer"
            className="text-primary underline">business.didit.me</a>
          {' '}→ Workflows. Include: ID Verification + Passive Liveness + Face Match.
        </p>
      </div>

      {/* Min Match Score */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label className="text-xs font-medium">Minimum Face Match Score to Pass</Label>
          <span className="text-sm font-semibold text-primary">{minScore}%</span>
        </div>
        <Slider
          value={[minScore]}
          min={60}
          max={95}
          step={5}
          onValueChange={([v]) => setMinScore(v)}
          className="w-full"
        />
        <p className="text-xs text-muted-foreground">
          Verifications below this score are flagged for analyst review (not auto-rejected).
        </p>
      </div>

      {/* Webhook Configuration */}
      <div className="space-y-3 border-t border-border pt-5">
        <div className="flex items-center gap-2">
          <h4 className="text-sm font-semibold">Webhook Configuration</h4>
          {tenant?.didit_webhook_secret ? (
            <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-full px-2 py-0.5">
              <ShieldCheck className="w-3 h-3" /> Secured
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 text-xs font-medium text-amber-700 bg-amber-50 border border-amber-200 rounded-full px-2 py-0.5">
              <ShieldAlert className="w-3 h-3" /> Not configured
            </span>
          )}
        </div>

        <div className="space-y-1.5">
          <Label className="text-xs font-medium">Webhook Destination URL</Label>
          <div className="flex items-center gap-2">
            <code className="flex-1 text-xs bg-muted px-3 py-2 rounded border border-border font-mono break-all">
              {WEBHOOK_URL}
            </code>
            <Button variant="outline" size="sm" className="h-9 w-9 p-0 flex-shrink-0"
              onClick={() => navigator.clipboard.writeText(WEBHOOK_URL)}>
              <Copy className="w-3.5 h-3.5" />
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Register this URL as a webhook destination on Didit so verification decisions
            are pushed to us in real time (recommended). Without it, the portal falls back
            to polling for results.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <Button variant="outline" size="sm" disabled={!apiKey || registering} onClick={handleRegisterWebhook} className="gap-2">
            {registering ? <Loader2 className="w-4 h-4 animate-spin" /> : <ShieldCheck className="w-4 h-4" />}
            Register Webhook
          </Button>
          <Button variant="outline" size="sm" disabled={!tenant?.didit_webhook_secret || testingHook} onClick={handleTestWebhook} className="gap-2">
            {testingHook ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
            Test Webhook
          </Button>
        </div>

        {hookMsg && (
          <div className={`flex items-center gap-2 text-sm rounded-lg px-3 py-2 border ${
            hookMsg.type === 'ok'
              ? 'text-green-700 bg-green-50 border-green-200'
              : 'text-red-700 bg-red-50 border-red-200'
          }`}>
            {hookMsg.type === 'ok' ? <CheckCircle2 className="w-4 h-4 flex-shrink-0" /> : <XCircle className="w-4 h-4 flex-shrink-0" />}
            {hookMsg.text}
          </div>
        )}

        <div className="space-y-1.5 pt-1">
          <Label className="text-xs font-medium">Webhook Secret (manual entry)</Label>
          <div className="flex items-center gap-2">
            <Input
              type="password"
              value={webhookSecret}
              onChange={e => setWebhookSecret(e.target.value)}
              placeholder="Paste secret_shared_key if registered directly in the Didit console"
              className="h-9 text-sm font-mono flex-1"
            />
            <Button size="sm" variant="outline" disabled={savingSecret} onClick={handleSaveSecret} className="gap-2 flex-shrink-0">
              {savingSecret ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              Save
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Only needed if you registered the webhook destination yourself in the Didit
            console instead of using the button above.
          </p>
        </div>
      </div>

      {/* Test Result */}
      {testResult === 'ok' && (
        <div className="flex items-center gap-2 text-sm text-green-700 bg-green-50 border border-green-200 rounded-lg px-3 py-2">
          <CheckCircle2 className="w-4 h-4 flex-shrink-0" />
          ✓ Connected — Didit credentials valid
        </div>
      )}
      {testResult === 'fail' && (
        <div className="flex items-center gap-2 text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
          <XCircle className="w-4 h-4 flex-shrink-0" />
          ✗ Connection failed — check API key and workflow ID
        </div>
      )}

      {/* Actions */}
      <div className="flex items-center gap-3 pt-1">
        <Button
          variant="outline"
          size="sm"
          disabled={!apiKey || !workflowId || testing}
          onClick={handleTest}
          className="gap-2"
        >
          {testing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Wifi className="w-4 h-4" />}
          Test Connection
        </Button>

        <Button
          size="sm"
          disabled={saving}
          onClick={handleSave}
          className="gap-2"
        >
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          Save Settings
        </Button>
      </div>
    </div>
  );
}