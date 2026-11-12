import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { ArrowRight, CheckCircle, XCircle, Loader2, Bot, FileSearch } from 'lucide-react';
import QcHumanActionCard from '@/components/case/signoff/QcHumanActionCard';

const SEV = {
  blocker: 'border-red-200 bg-red-50 text-red-800',
  major: 'border-amber-200 bg-amber-50 text-amber-800',
  minor: 'border-slate-200 bg-slate-50 text-slate-700',
};
const DONE = ['resolved', 'dismissed', 'carried'];
const STEP_ORDER = [1, 2, 3, 4, 5, 6, 7, 10];

function FindingRow({ f, onNavigateToStep, onDismiss, busy }) {
  const [dismissing, setDismissing] = useState(false);
  const [reason, setReason] = useState('');
  const done = DONE.includes(f.status);
  return (
    <li className={cn('rounded-lg border border-border bg-card p-2.5 text-xs', done && 'opacity-60')}>
      <div className="flex items-start gap-2">
        {done ? <CheckCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600" /> : <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-red-500" />}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className={cn('rounded-full border px-1.5 py-0 text-[10px] font-medium capitalize', SEV[f.severity])}>{f.severity}</span>
            <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground">{f.check === 'report' ? <FileSearch className="h-3 w-3" /> : <Bot className="h-3 w-3" />}{f.check === 'report' ? 'Report Check' : 'Case Check'} · {f.code}</span>
            {f.owner && <span className="text-[10px] text-muted-foreground">· {f.owner}</span>}
          </div>
          <p className={cn('mt-0.5', done && 'line-through')}>{f.text}</p>
          {(f.report_value || f.case_value) && (
            <div className="mt-1 grid grid-cols-2 gap-2 text-[11px]">
              <div><span className="text-muted-foreground">Report: </span>{f.report_value || '—'}</div>
              <div><span className="text-muted-foreground">Case: </span>{f.case_value || '—'}</div>
            </div>
          )}
          {done && f.resolution_text && <p className="mt-0.5 text-[11px] text-muted-foreground">{f.status === 'dismissed' ? 'Dismissed: ' : ''}{f.resolution_text}</p>}
          {dismissing && (
            <div className="mt-1.5 flex gap-1.5">
              <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason (at least 10 characters)" className="h-7 text-xs" />
              <Button size="sm" className="h-7" disabled={reason.trim().length < 10 || !!busy} onClick={() => onDismiss(f, reason)}>{busy ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Dismiss'}</Button>
              <Button size="sm" variant="ghost" className="h-7" onClick={() => setDismissing(false)}>Cancel</Button>
            </div>
          )}
        </div>
        {!done && (
          <div className="flex shrink-0 gap-1">
            {f.severity === 'minor' && !dismissing && onDismiss && <Button size="sm" variant="ghost" className="h-6 px-2 text-[11px]" onClick={() => setDismissing(true)}>Dismiss</Button>}
            {f.step && f.step !== 10 && <Button size="sm" variant="outline" className="h-6 gap-1 px-2 text-[11px]" onClick={() => onNavigateToStep?.(f.step)}>Go to step <ArrowRight className="h-3 w-3" /></Button>}
          </div>
        )}
      </div>
    </li>
  );
}

/** Findings grouped by process step; human-decision findings render as a decision card. */
export default function QcFindingsPanel({ findings = [], strictness, busy, onNavigateToStep, onDecide, onDismiss, readOnly }) {
  const human = findings.filter((f) => f.kind === 'human' && f.status === 'needs_human');
  const rest = findings.filter((f) => !(f.kind === 'human' && f.status === 'needs_human'));
  const steps = [...new Set(rest.map((f) => f.step))].sort((a, b) => STEP_ORDER.indexOf(a) - STEP_ORDER.indexOf(b));
  if (!findings.length) return <p className="text-xs text-muted-foreground">No findings in this round.</p>;
  return (
    <div className="space-y-4">
      {!readOnly && human.map((f) => (
        <QcHumanActionCard key={f.id} finding={f} strictness={strictness} busy={busy === `record_human_action:${f.id}`} onDecide={onDecide} />
      ))}
      {steps.map((s) => {
        const items = rest.filter((f) => f.step === s);
        const open = items.filter((f) => !DONE.includes(f.status)).length;
        return (
          <div key={s} className="space-y-1.5">
            <div className="flex items-center justify-between text-xs font-semibold">
              <span>{items[0]?.step_label || `Step ${s}`}</span>
              <span className={cn('text-[11px] font-normal', open ? 'text-red-700' : 'text-emerald-700')}>{open ? `${open} open` : 'all resolved'}</span>
            </div>
            <ul className="space-y-1.5">
              {items.map((f) => <FindingRow key={f.id} f={f} onNavigateToStep={onNavigateToStep} onDismiss={readOnly ? null : onDismiss} busy={busy === `dismiss_finding:${f.id}`} />)}
            </ul>
          </div>
        );
      })}
    </div>
  );
}
