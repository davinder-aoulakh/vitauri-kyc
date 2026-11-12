import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { cn } from '@/lib/utils';
import { Loader2, UserCheck, AlertTriangle } from 'lucide-react';

const CHOICES = [
  { value: 'Plausible', label: 'Plausible', hint: 'The explanation and evidence support it.' },
  { value: 'Not plausible', label: 'Not plausible', hint: 'Raises the classification to at least High and re-routes the case.' },
  { value: 'Cannot decide yet', label: 'Cannot decide yet', hint: 'Drafts an outreach request to the client; QC waits for the answer.' },
];
const FIT = { yes: 'text-emerald-700', no: 'text-red-700', unclear: 'text-amber-700' };

/** "A person must decide" card (spec §6.2): nothing preselected; strict = every evidence box + reasons ≥ 30 characters. */
export default function QcHumanActionCard({ finding, strictness = 'light', busy, onDecide }) {
  const h = finding.human || {};
  const items = h.evidence_items || [];
  const [choice, setChoice] = useState('');
  const [reasons, setReasons] = useState('');
  const [evidence, setEvidence] = useState(items.map(() => false));
  const strict = strictness === 'strict';
  const min = strict ? 30 : 10;
  const waiting = finding.resolution_text === 'waiting_for_client';
  const evidenceOk = !strict || choice === 'Cannot decide yet' || evidence.every(Boolean);
  const valid = choice && reasons.trim().length >= min && evidenceOk;

  return (
    <div className="space-y-3 rounded-xl border-2 border-amber-300 bg-amber-50/40 p-4">
      <div className="flex items-start gap-2">
        <UserCheck className="mt-0.5 h-4 w-4 text-amber-700" />
        <div className="flex-1">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-amber-800">A person must decide · {finding.step_label}</div>
          <div className="text-sm font-semibold">{h.question || finding.text}</div>
          <p className="mt-0.5 text-xs text-muted-foreground">{finding.text}</p>
        </div>
        <span className={cn('rounded-full border px-2 py-0.5 text-[10px] font-medium', strict ? 'border-red-200 bg-red-50 text-red-800' : 'border-slate-200 bg-white text-slate-700')}>{strict ? 'Strict confirmation' : 'Light confirmation'}</span>
      </div>

      {(h.comparison || []).length > 0 && (
        <div className="overflow-hidden rounded-lg border border-border bg-card">
          <table className="w-full text-xs">
            <thead className="bg-muted/50 text-left text-[11px] text-muted-foreground"><tr><th className="px-3 py-1.5">Datapoint</th><th className="px-3 py-1.5">Declared</th><th className="px-3 py-1.5">Observed</th><th className="px-3 py-1.5">Fit</th></tr></thead>
            <tbody>
              {h.comparison.map((r, i) => (
                <tr key={i} className="border-t border-border align-top">
                  <td className="px-3 py-1.5 font-medium">{r.datapoint}</td><td className="px-3 py-1.5">{r.declared}</td><td className="px-3 py-1.5">{r.observed}</td>
                  <td className={cn('px-3 py-1.5 font-medium capitalize', FIT[r.fit])}>{r.fit}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {h.ai_suggestion && (
        <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 p-2.5 text-xs text-slate-700">
          <div className="mb-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500">AI suggestion — you decide</div>{h.ai_suggestion}
        </div>
      )}

      {waiting ? (
        <div className="flex items-center gap-2 rounded-lg border border-blue-200 bg-blue-50 p-2.5 text-xs text-blue-900">
          <AlertTriangle className="h-4 w-4" /> Waiting for the client. An outreach request was drafted in Outreach & Documents; send it, then decide here once the answer is in.
        </div>
      ) : null}

      <fieldset className="space-y-1.5">
        <legend className="mb-1 text-xs font-medium">Your decision</legend>
        {CHOICES.filter((c) => !(waiting && c.value === 'Cannot decide yet')).map((c) => (
          <label key={c.value} className={cn('flex cursor-pointer items-start gap-2 rounded-lg border p-2 text-xs', choice === c.value ? 'border-primary bg-primary/5' : 'border-border bg-card')}>
            <input type="radio" name={`qc-${finding.id}`} value={c.value} checked={choice === c.value} onChange={() => setChoice(c.value)} className="mt-0.5" />
            <span><span className="font-medium">{c.label}</span><span className="block text-muted-foreground">{c.hint}</span></span>
          </label>
        ))}
      </fieldset>

      {items.length > 0 && (
        <div className="space-y-1.5">
          <div className="text-xs font-medium">Evidence checked{strict ? ' (all required)' : ''}</div>
          {items.map((t, i) => (
            <label key={i} className="flex items-center gap-2 text-xs">
              <Checkbox checked={evidence[i]} onCheckedChange={(v) => setEvidence((e) => e.map((x, j) => (j === i ? v === true : x)))} />{t}
            </label>
          ))}
        </div>
      )}

      <div className="space-y-1">
        <label htmlFor={`r-${finding.id}`} className="text-xs font-medium">Reasons</label>
        <Textarea id={`r-${finding.id}`} value={reasons} onChange={(e) => setReasons(e.target.value)} className="min-h-20 text-sm" placeholder="Why do you decide this? This goes into the QC record and the report." />
        <div className={cn('text-right text-[11px]', reasons.trim().length >= min ? 'text-emerald-700' : 'text-muted-foreground')}>{reasons.trim().length} / {min} characters minimum</div>
      </div>

      <div className="flex justify-end">
        <Button size="sm" disabled={!valid || !!busy} onClick={() => onDecide({ finding_id: finding.id, choice, reasons, evidence_confirmed: evidence })}>
          {busy ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : null}Record decision
        </Button>
      </div>
    </div>
  );
}
