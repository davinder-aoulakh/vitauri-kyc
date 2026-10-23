import React, { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import InlineError from '@/components/shared/InlineError';
import { AlertTriangle, CalendarClock, CheckCircle2, Loader2, ShieldCheck } from 'lucide-react';

export const VALIDATION_ROLES = ['Compliance Officer', 'Compliance Admin', 'Director', 'Tenant Admin'];
const OUTCOME = {
  passed: { label: 'Passed', cls: 'border-emerald-200 bg-emerald-50 text-emerald-700' },
  passed_with_findings: { label: 'Passed with findings', cls: 'border-amber-200 bg-amber-50 text-amber-800' },
  failed: { label: 'Failed', cls: 'border-red-200 bg-red-50 text-red-700' },
};
const today = () => new Date().toISOString().slice(0, 10);
const plusYear = () => { const d = new Date(); d.setFullYear(d.getFullYear() + 1); return d.toISOString().slice(0, 10); };
const daysUntil = (date) => Math.ceil((new Date(`${date}T00:00:00`) - new Date(`${today()}T00:00:00`)) / 86400000);

/** Next-validation state for the KPI strip: { label, tone }. */
export function nextValidationState(latest) {
  if (!latest) return { label: 'Never validated', tone: 'bad' };
  const d = daysUntil(latest.next_due_at);
  if (d < 0) return { label: `Overdue ${-d} d`, tone: 'bad' };
  if (d <= 30) return { label: `Due in ${d} d`, tone: 'warn' };
  return { label: latest.next_due_at, tone: 'ok' };
}

export function useModelValidations(tenantId, enabled) {
  return useQuery({
    queryKey: ['modelValidations', tenantId], enabled: enabled && !!tenantId, staleTime: 60000,
    queryFn: async () => {
      const r = await base44.entities.ModelValidation.filter({ tenant_id: tenantId }, '-validated_at', 20);
      return Array.isArray(r) ? r : r?.items || [];
    },
  });
}

function RecordForm({ onDone, onCancel }) {
  const [f, setF] = useState({ validated_at: today(), scope: 'Rules, scenarios and AI triage', outcome: 'passed', findings: '', validator: '', next_due_at: plusYear(), evidence_url: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const set = (k) => (e) => setF((s) => ({ ...s, [k]: e?.target ? e.target.value : e }));
  const submit = async () => {
    setBusy(true); setError('');
    try {
      const res = (await base44.functions.invoke('recordModelValidation', f))?.data;
      if (res?.error) throw new Error(res.error);
      await onDone();
    } catch (e) { setError(e?.response?.data?.error || e.message || 'Could not record the validation.'); } finally { setBusy(false); }
  };
  return (
    <div className="mt-3 space-y-2 rounded-lg border border-border p-3">
      <div className="grid gap-2 sm:grid-cols-2">
        <label className="text-xs">Validated on<Input type="date" value={f.validated_at} onChange={set('validated_at')} className="mt-1 h-8" /></label>
        <label className="text-xs">Next validation due<Input type="date" value={f.next_due_at} onChange={set('next_due_at')} className="mt-1 h-8" /></label>
        <label className="text-xs">Scope<Input value={f.scope} onChange={set('scope')} className="mt-1 h-8" /></label>
        <label className="text-xs">Validated by (function or firm)<Input value={f.validator} onChange={set('validator')} className="mt-1 h-8" placeholder="e.g. Internal audit" /></label>
        <div className="text-xs">Outcome
          <Select value={f.outcome} onValueChange={set('outcome')}>
            <SelectTrigger className="mt-1 h-8 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>{Object.entries(OUTCOME).map(([k, v]) => <SelectItem key={k} value={k}>{v.label}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <label className="text-xs">Evidence link (optional)<Input value={f.evidence_url} onChange={set('evidence_url')} className="mt-1 h-8" placeholder="Report location" /></label>
      </div>
      <Textarea value={f.findings} onChange={set('findings')} rows={2} placeholder={f.outcome === 'passed' ? 'Findings (optional)' : 'Findings (required)'} />
      {error && <InlineError message={error} />}
      <div className="flex justify-end gap-2">
        <Button size="sm" variant="outline" onClick={onCancel} disabled={busy}>Cancel</Button>
        <Button size="sm" onClick={submit} disabled={busy || !f.scope.trim()} className="gap-1.5">{busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Record validation</Button>
      </div>
    </div>
  );
}

/** Model validation record for the Quality page: latest outcome, next due date and history. */
export default function ModelValidationCard({ tenantId, role }) {
  const qc = useQueryClient();
  const { data = [], isLoading, error, refetch } = useModelValidations(tenantId, true);
  const [recording, setRecording] = useState(false);
  const canRecord = VALIDATION_ROLES.includes(role);
  const latest = data[0];
  const next = nextValidationState(latest);
  const NextIcon = next.tone === 'ok' ? CheckCircle2 : next.tone === 'warn' ? CalendarClock : AlertTriangle;
  const nextCls = next.tone === 'ok' ? 'text-emerald-700' : next.tone === 'warn' ? 'text-amber-700' : 'text-destructive';

  return (
    <section className="mt-5 rounded-xl border border-border bg-card p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2"><ShieldCheck className="h-4 w-4 text-primary" /><h3 className="text-sm font-semibold">Model validation</h3></div>
        <div className="flex items-center gap-3">
          <span className={`inline-flex items-center gap-1 text-xs font-medium ${nextCls}`}><NextIcon className="h-3.5 w-3.5" /> Next validation: {next.label}</span>
          {canRecord && !recording && <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setRecording(true)}>Record validation</Button>}
        </div>
      </div>
      {error && <InlineError className="mt-2" message="Couldn't load validations." onRetry={refetch} />}
      {isLoading && <div className="flex justify-center py-4"><Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /></div>}
      {!isLoading && !error && data.length === 0 && <p className="mt-2 text-xs text-muted-foreground">No validation recorded yet. The monitoring model (rules, scenarios and AI triage) should be validated independently at least once a year.</p>}
      {data.length > 0 && (
        <ul className="mt-3 divide-y divide-border text-xs">
          {data.slice(0, 5).map((v) => (
            <li key={v.id} className="flex flex-wrap items-center gap-2 py-1.5">
              <span className="tabular-nums text-muted-foreground">{String(v.validated_at).slice(0, 10)}</span>
              <span className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${OUTCOME[v.outcome]?.cls || ''}`}>{OUTCOME[v.outcome]?.label || v.outcome}</span>
              <span className="font-medium">{v.scope}</span>
              {v.validator && <span className="text-muted-foreground">· {v.validator}</span>}
              {v.findings && <span className="w-full text-muted-foreground">{v.findings}</span>}
            </li>
          ))}
        </ul>
      )}
      {recording && <RecordForm onCancel={() => setRecording(false)} onDone={async () => { setRecording(false); await qc.invalidateQueries({ queryKey: ['modelValidations', tenantId] }); }} />}
    </section>
  );
}
