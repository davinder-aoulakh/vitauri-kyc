import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { X, Plus, Trash2, Star, Save, Wifi,
         CheckCircle2, XCircle, Loader2, ShieldCheck, ShieldAlert, Copy, Send } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

const WEBHOOK_URL = 'https://vitauri-kyc.base44.app/functions/diditWebhook';

export default function OpsDiditPanel({ tenant, onClose, onSaved }) {
  const [apiKey,     setApiKey]     = useState(tenant?.didit_api_key || '');
  const [workflows,  setWorkflows]  = useState(() => {
    try { return JSON.parse(tenant?.didit_workflows || '[]'); }
    catch { return []; }
  });
  const [saving,     setSaving]     = useState(false);
  const [testing,    setTesting]    = useState(false);
  const [testResult, setTestResult] = useState(null); // null|'ok'|'fail'
  const [newWf,      setNewWf]      = useState({ name: '', workflow_id: '', description: '' });
  const [addingWf,   setAddingWf]   = useState(false);

  const [webhookSecret, setWebhookSecret] = useState(tenant?.didit_webhook_secret || '');
  const [registering,   setRegistering]   = useState(false);
  const [testingHook,   setTestingHook]   = useState(false);
  const [savingSecret,  setSavingSecret]  = useState(false);
  const [hookMsg,       setHookMsg]       = useState(null); // { type: 'ok'|'fail', text }

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
        if (data?.secret_configured) setWebhookSecret(tenant?.didit_webhook_secret || webhookSecret || '••• saved •••');
        setHookMsg({ type: 'ok', text: data?.updated ? 'Webhook destination updated.' : 'Webhook registered — secret saved.' });
        onSaved?.();
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
    onSaved?.();
  }

  async function testConnection() {
    setTesting(true); setTestResult(null);
    try {
      const res = await base44.functions.invoke('createDiditSession', {
        _test_only: true,
        api_key: apiKey,
        workflow_id: workflows.find(w => w.is_default)?.workflow_id || workflows[0]?.workflow_id || '',
      });
      setTestResult((res?.data || res)?.error ? 'fail' : 'ok');
    } catch { setTestResult('fail'); }
    finally { setTesting(false); }
  }

  async function save() {
    setSaving(true);
    await base44.entities.Tenant.update(tenant.id, {
      didit_api_key:    apiKey,
      didit_workflows:  JSON.stringify(workflows),
      didit_workflow_id: workflows.find(w => w.is_default)?.workflow_id
                       || workflows[0]?.workflow_id
                       || '',
    });
    setSaving(false);
    onSaved?.();
  }

  function addWorkflow() {
    if (!newWf.name.trim() || !newWf.workflow_id.trim()) return;
    const wf = {
      id:          Date.now().toString(36),
      name:        newWf.name.trim(),
      workflow_id: newWf.workflow_id.trim(),
      description: newWf.description.trim(),
      is_default:  workflows.length === 0,
    };
    setWorkflows(prev => [...prev, wf]);
    setNewWf({ name: '', workflow_id: '', description: '' });
    setAddingWf(false);
  }

  function removeWorkflow(id) {
    setWorkflows(prev => {
      const next = prev.filter(w => w.id !== id);
      if (prev.find(w => w.id === id)?.is_default && next.length > 0) {
        next[0] = { ...next[0], is_default: true };
      }
      return next;
    });
  }

  function setDefault(id) {
    setWorkflows(prev => prev.map(w => ({ ...w, is_default: w.id === id })));
  }

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/40" onClick={onClose} />
      <div className="fixed inset-y-0 right-0 z-50 flex flex-col bg-card border-l border-border shadow-2xl w-full md:w-[520px]">

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border flex-shrink-0">
          <div>
            <div className="flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-primary" />
              <span className="font-semibold text-sm">Didit Configuration</span>
              <span className="text-xs bg-primary/10 text-primary px-2 py-0.5 rounded-full font-medium">
                Vitauri Ops Only
              </span>
            </div>
            <div className="text-xs text-muted-foreground mt-0.5">
              {tenant?.name} · {tenant?.slug}
            </div>
          </div>
          <Button variant="ghost" size="sm" className="h-8 w-8 p-0" onClick={onClose}>
            <X className="w-4 h-4" />
          </Button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-6">

          {/* API Key */}
          <div className="bg-card border border-border rounded-xl p-4 space-y-3">
            <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
              Didit API Key
            </div>
            <div className="text-xs text-muted-foreground">
              Get from business.didit.me → API Keys. Shared across all workflows for this tenant.
            </div>
            <Input
              type="password"
              value={apiKey}
              onChange={e => setApiKey(e.target.value)}
              placeholder="ddt_live_xxxxxxxxxxxxxxxx"
              className="font-mono text-xs h-9"
            />
            <div className="flex items-center gap-2">
              <Button size="sm" variant="outline" className="h-8 text-xs gap-1.5"
                onClick={testConnection} disabled={!apiKey || testing}>
                {testing
                  ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  : <Wifi className="w-3.5 h-3.5" />}
                Test Connection
              </Button>
              {testResult === 'ok' && (
                <span className="text-xs text-emerald-600 flex items-center gap-1">
                  <CheckCircle2 className="w-3.5 h-3.5" /> Connected
                </span>
              )}
              {testResult === 'fail' && (
                <span className="text-xs text-red-600 flex items-center gap-1">
                  <XCircle className="w-3.5 h-3.5" /> Failed — check key
                </span>
              )}
            </div>
          </div>

          {/* Workflows */}
          <div className="bg-card border border-border rounded-xl p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                Didit Workflows ({workflows.length})
              </div>
              <Button size="sm" variant="outline" className="h-7 text-xs gap-1"
                onClick={() => setAddingWf(true)} disabled={addingWf}>
                <Plus className="w-3.5 h-3.5" /> Add Workflow
              </Button>
            </div>
            <div className="text-xs text-muted-foreground">
              Configure in business.didit.me → Workflows. Mark one as <strong>default</strong> — it is used when no specific workflow is set on an outreach template field.
            </div>

            {workflows.length === 0 && !addingWf && (
              <div className="text-center py-8 text-xs text-muted-foreground">
                No workflows configured yet. Add at least one to enable IDV.
              </div>
            )}

            <div className="space-y-2">
              {workflows.map(wf => (
                <div key={wf.id} className={cn(
                  'flex items-start gap-3 p-3 rounded-lg border',
                  wf.is_default ? 'border-primary/30 bg-primary/5' : 'border-border bg-muted/20'
                )}>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-semibold text-foreground">{wf.name}</span>
                      {wf.is_default && (
                        <span className="text-xs bg-primary text-white px-1.5 py-0.5 rounded-full font-medium">
                          Default
                        </span>
                      )}
                    </div>
                    <div className="text-xs font-mono text-muted-foreground mt-0.5">{wf.workflow_id}</div>
                    {wf.description && (
                      <div className="text-xs text-muted-foreground mt-1">{wf.description}</div>
                    )}
                  </div>
                  <div className="flex items-center gap-1 flex-shrink-0">
                    {!wf.is_default && (
                      <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-muted-foreground"
                        title="Set as default" onClick={() => setDefault(wf.id)}>
                        <Star className="w-3.5 h-3.5" />
                      </Button>
                    )}
                    <Button size="sm" variant="ghost"
                      className="h-7 w-7 p-0 text-red-500 hover:text-red-700"
                      onClick={() => removeWorkflow(wf.id)}>
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>

            {addingWf && (
              <div className="border border-primary/20 bg-primary/5 rounded-lg p-4 space-y-3">
                <div className="text-xs font-semibold">New Workflow</div>
                <div className="space-y-2">
                  <Input
                    placeholder="Workflow name (e.g. Standard KYC)"
                    value={newWf.name}
                    onChange={e => setNewWf(p => ({ ...p, name: e.target.value }))}
                    className="h-8 text-xs"
                  />
                  <Input
                    placeholder="Didit Workflow ID (UUID from Console)"
                    value={newWf.workflow_id}
                    onChange={e => setNewWf(p => ({ ...p, workflow_id: e.target.value }))}
                    className="h-8 text-xs font-mono"
                  />
                  <Input
                    placeholder="Description (optional)"
                    value={newWf.description}
                    onChange={e => setNewWf(p => ({ ...p, description: e.target.value }))}
                    className="h-8 text-xs"
                  />
                </div>
                <div className="flex gap-2">
                  <Button size="sm" className="h-7 text-xs flex-1"
                    onClick={addWorkflow}
                    disabled={!newWf.name.trim() || !newWf.workflow_id.trim()}>
                    Add
                  </Button>
                  <Button size="sm" variant="ghost" className="h-7 text-xs"
                    onClick={() => { setAddingWf(false); setNewWf({ name: '', workflow_id: '', description: '' }); }}>
                    Cancel
                  </Button>
                </div>
              </div>
            )}
          </div>

          {/* Webhook Configuration */}
          <div className="bg-card border border-border rounded-xl p-4 space-y-3">
            <div className="flex items-center gap-2">
              <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                Webhook Configuration
              </div>
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
            <div className="text-xs text-muted-foreground">
              Registers the webhook destination on Didit so verification decisions are pushed to us in
              real time. Without it, the portal falls back to polling for results.
            </div>

            <div className="flex items-center gap-2">
              <code className="flex-1 text-xs bg-muted px-3 py-2 rounded border border-border font-mono break-all">
                {WEBHOOK_URL}
              </code>
              <Button variant="outline" size="sm" className="h-9 w-9 p-0 flex-shrink-0"
                onClick={() => navigator.clipboard.writeText(WEBHOOK_URL)}>
                <Copy className="w-3.5 h-3.5" />
              </Button>
            </div>

            <div className="flex items-center gap-2">
              <Button size="sm" variant="outline" className="h-8 text-xs gap-1.5" disabled={!apiKey || registering} onClick={handleRegisterWebhook}>
                {registering ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ShieldCheck className="w-3.5 h-3.5" />}
                Register Webhook
              </Button>
              <Button size="sm" variant="outline" className="h-8 text-xs gap-1.5" disabled={!tenant?.didit_webhook_secret || testingHook} onClick={handleTestWebhook}>
                {testingHook ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
                Test Webhook
              </Button>
            </div>

            {hookMsg && (
              <div className={cn('flex items-center gap-2 text-xs rounded-lg px-3 py-2 border',
                hookMsg.type === 'ok' ? 'text-green-700 bg-green-50 border-green-200' : 'text-red-700 bg-red-50 border-red-200')}>
                {hookMsg.type === 'ok' ? <CheckCircle2 className="w-3.5 h-3.5 flex-shrink-0" /> : <XCircle className="w-3.5 h-3.5 flex-shrink-0" />}
                {hookMsg.text}
              </div>
            )}

            <div className="space-y-1.5 pt-1 border-t border-border">
              <div className="text-xs font-medium">Webhook Secret (manual entry)</div>
              <div className="flex items-center gap-2">
                <Input
                  type="password"
                  value={webhookSecret}
                  onChange={e => setWebhookSecret(e.target.value)}
                  placeholder="Paste secret_shared_key if registered directly in the Didit console"
                  className="h-9 text-xs font-mono flex-1"
                />
                <Button size="sm" variant="outline" disabled={savingSecret} onClick={handleSaveSecret} className="h-9 text-xs gap-1.5 flex-shrink-0">
                  {savingSecret ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                  Save
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Only needed if you registered the webhook destination directly in the Didit console.
              </p>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="border-t border-border px-5 py-4 flex-shrink-0 flex gap-3">
          <Button variant="outline" className="flex-none" onClick={onClose}>Cancel</Button>
          <Button className="flex-1 gap-2" onClick={save} disabled={saving}>
            {saving && <Loader2 className="w-4 h-4 animate-spin" />}
            <Save className="w-4 h-4" />
            Save Configuration
          </Button>
        </div>
      </div>
    </>
  );
}