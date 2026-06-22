import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { Loader2, Save, CheckCircle2, XCircle, Wifi } from 'lucide-react';

export default function DiditConfigTab({ tenant, onSave }) {
  const [apiKey,     setApiKey]     = useState(tenant?.didit_api_key      || '');
  const [workflowId, setWorkflowId] = useState(tenant?.didit_workflow_id  || '');
  const [minScore,   setMinScore]   = useState(tenant?.didit_min_match_score ?? 80);
  const [testing,    setTesting]    = useState(false);
  const [testResult, setTestResult] = useState(null); // null | 'ok' | 'fail'
  const [saving,     setSaving]     = useState(false);

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
          From Didit Console → API Keys. Keep this secret.
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

      {/* Webhook URL (read-only) */}
      <div className="space-y-1.5">
        <Label className="text-xs font-medium">Webhook Destination URL (for Didit Console)</Label>
        <code className="block text-xs bg-muted px-3 py-2 rounded border border-border font-mono break-all">
          {window.location.origin}/api/webhooks/didit
        </code>
        <p className="text-xs text-muted-foreground">
          Note: for Base44 apps, leave webhook destination empty in Didit Console.
          Verification results are fetched via callback URL instead.
        </p>
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