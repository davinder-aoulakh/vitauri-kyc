import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import { ArrowRight, CheckCircle, XCircle, Loader2, Bot, FileSearch, Gavel } from 'lucide-react';
import { format } from 'date-fns';
import QcHumanActionCard from '@/components/case/signoff/QcHumanActionCard';

const SEV = {
  blocker: 'border-red-200 bg-red-50 text-red-800',
  major: 'border-amber-200 bg-amber-50 text-amber-800',
  minor: 'border-slate-200 bg-slate-50 text-slate-700',
};
const DONE = ['resolved', 'dismissed', 'carried', 'overruled'];
const fmt = (d) => { try { return d ? format(new Date(d), 'd MMM yyyy HH:mm') : ''; } catch { return ''; } };

/** Rationale box of an overrule: mandatory, minimum length, with a counter. */
function OverruleBox({ min, busy, label, onConfirm, onCancel }) {
  const [text, setText] = useState('');
  const n = text.trim().length;
  return (
    <div className="mt-2 space-y-1.5 rounded-lg border border-violet-200 bg-violet-50/60 p-2">
      <label className="block text-[11px] font-medium text-violet-900">Rationale of the QC Officer (required, recorded in the audit trail)</label>
      <Textarea value={text} onChange={(e) => setText(e.target.value)} className="min-h-16 bg-background text-xs" placeholder="Why is the finding of the QC Agent set aside? What did you check?" />
      <div className="flex items-center gap-1.5">
        <span className={cn('text-[11px]', n >= min ? 'text-emerald-700' : 'text-muted-foreground')}>{n} / {min} characters minimum</span>
        <Button size="sm" variant="ghost" className="ml-auto h-7" disabled={!!busy} onClick={onCancel}>Cancel</Button>
        <Button size="sm" className="h-7 gap-1 bg-violet-700 text-white hover:bg-violet-800" disabled={n < min || !!busy} onClick={() => onConfirm(text.trim())}>
          {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Gavel className="h-3 w-3" />} {label}
        </Button>
      </div>
    </div>
  );
}
const STEP_ORDER = [1, 2, 3, 4, 5, 6, 7, 10];

function FindingRow({ f, onNavigateToStep, onDismiss, onOverrule, overruleMin, busy, overruleBusy }) {
  const [dismissing, setDismissing] = useState(false);
  const [overruling, setOverruling] = useState(false);
  const overruled = f.status === 'overruled';
  const [reason, setReason] = useState('');
  const done = DONE.includes(f.status);
  return (
    <li className={cn('rounded-lg border border-border bg-card p-2.5 text-xs', done && 'opacity-60')}>
      <div className="flex items-start gap-2">
        {overruled ? <Gavel className="mt-0.5 h-3.5 w-3.5 shrink-0 text-violet-700" /> : done ? <CheckCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600" /> : <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-red-500" />}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className={cn('rounded-full border px-1.5 py-0 text-[10px] font-medium capitalize', SEV[f.severity])}>{f.severity}</span>
            <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground">{f.check === 'report' ? <FileSearch className="h-3 w-3" /> : <Bot className="h-3 w-3" />}{f.check === 'report' ? 'Report Check' : 'Case Check'} · {f.code}</span>
            {f.owner && <span className="text-[10px] text-muted-foreground">· {f.owner}</span>}
            {overruled && <span className="rounded-full border border-violet-300 bg-violet-50 px-1.5 py-0 text-[10px] font-medium text-violet-800">Overruled</span>}
          </div>
          <p className={cn('mt-0.5', done && !overruled && 'line-through')}>{f.text}</p>
          {(f.report_value || f.case_value) && (
            <div className="mt-1 grid grid-cols-2 gap-2 text-[11px]">
              <div><span className="text-muted-foreground">Report: </span>{f.report_value || '—'}</div>
              <div><span className="text-muted-foreground">Case: </span>{f.case_value || '—'}</div>
            </div>
          )}
          {done && !overruled && f.resolution_text && <p className="mt-0.5 text-[11px] text-muted-foreground">{f.status === 'dismissed' ? 'Dismissed: ' : ''}{f.resolution_text}</p>}
          {overruled && (
            <p className="mt-0.5 text-[11px] text-violet-900">
              <span className="font-medium">Overruled by {f.resolved_by_name || 'QC Officer'}{f.resolved_at ? ` · ${fmt(f.resolved_at)}` : ''}{f.resolved_in_round && f.round && f.resolved_in_round !== f.round ? ` · round ${f.resolved_in_round}` : ''}:</span> {f.resolution_text}
            </p>
          )}
          {overruling && <OverruleBox min={overruleMin} busy={overruleBusy} label="Overrule finding" onCancel={() => setOverruling(false)} onConfirm={(r) => onOverrule([f], r)} />}
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
            {onOverrule && f.overrulable && !overruling && !dismissing && <Button size="sm" variant="ghost" className="h-6 gap-1 px-2 text-[11px] text-violet-800 hover:bg-violet-50" onClick={() => setOverruling(true)}><Gavel className="h-3 w-3" /> Overrule</Button>}
            {f.severity === 'minor' && !dismissing && !overruling && onDismiss && <Button size="sm" variant="ghost" className="h-6 px-2 text-[11px]" onClick={() => setDismissing(true)}>Dismiss</Button>}
            {f.step && f.step !== 10 && <Button size="sm" variant="outline" className="h-6 gap-1 px-2 text-[11px]" onClick={() => onNavigateToStep?.(f.step)}>Go to step <ArrowRight className="h-3 w-3" /></Button>}
          </div>
        )}
      </div>
    </li>
  );
}

/** Findings grouped by process step; human-decision findings render as a decision card. */
export default function QcFindingsPanel({ findings = [], strictness, busy, onNavigateToStep, onDecide, onDismiss, onOverrule, canOverrule, overruleMin = 30, readOnly }) {
  const [allOpen, setAllOpen] = useState(false);
  const mayOverrule = !readOnly && !!canOverrule && !!onOverrule;
  const openAuto = findings.filter((f) => f.kind !== 'human' && ['open', 'returned'].includes(f.status));
  const blocking = openAuto.filter((f) => f.severity !== 'minor');
  const overrulable = blocking.filter((f) => f.overrulable);
  const fixed = blocking.filter((f) => !f.overrulable);
  const overruledCount = findings.filter((f) => f.status === 'overruled').length;
  const overruleAll = async (list, rationale) => { const ok = await onOverrule(list, rationale); if (ok) setAllOpen(false); };
  const human = findings.filter((f) => f.kind === 'human' && f.status === 'needs_human');
  const rest = findings.filter((f) => !(f.kind === 'human' && f.status === 'needs_human'));
  const steps = [...new Set(rest.map((f) => f.step))].sort((a, b) => STEP_ORDER.indexOf(a) - STEP_ORDER.indexOf(b));
  if (!findings.length) return <p className="text-xs text-muted-foreground">No findings in this round.</p>;
  return (
    <div className="space-y-4">
      {(mayOverrule && blocking.length > 0) || overruledCount > 0 ? (
        <div className="rounded-lg border border-violet-200 bg-violet-50/40 p-3 text-xs">
          <div className="flex flex-wrap items-center gap-2">
            <Gavel className="h-3.5 w-3.5 text-violet-800" />
            <span className="font-semibold text-violet-900">QC Officer — overrule</span>
            {overruledCount > 0 && <span className="rounded-full border border-violet-300 bg-violet-50 px-1.5 py-0 text-[10px] font-medium text-violet-800">{overruledCount} overruled</span>}
            {mayOverrule && overrulable.length > 0 && !allOpen && (
              <Button size="sm" variant="outline" className="ml-auto h-7 gap-1 border-violet-300 text-violet-900 hover:bg-violet-100" onClick={() => setAllOpen(true)}>
                <Gavel className="h-3 w-3" /> Overrule all blocking findings ({overrulable.length})
              </Button>
            )}
          </div>
          {mayOverrule && blocking.length > 0 && (
            <p className="mt-1 text-muted-foreground">
              {blocking.length} finding{blocking.length === 1 ? '' : 's'} of the QC Agent block{blocking.length === 1 ? 's' : ''} this round. As QC Officer you can set a finding aside with a rationale, per finding or all at once. Every overrule is recorded in the audit trail and shown to the approver and in the report.
            </p>
          )}
          {mayOverrule && fixed.length > 0 && (
            <p className="mt-1 text-amber-900">
              Cannot be overruled, settle in its step: {fixed.map((f) => `${f.step_label || `step ${f.step}`} (${f.code})`).filter((v, i, a) => a.indexOf(v) === i).join(', ')}.
            </p>
          )}
          {allOpen && <OverruleBox min={overruleMin} busy={busy === 'overrule_findings'} label={`Overrule ${overrulable.length} finding${overrulable.length === 1 ? '' : 's'}`} onCancel={() => setAllOpen(false)} onConfirm={(r) => overruleAll(overrulable, r)} />}
        </div>
      ) : null}
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
              {items.map((f) => <FindingRow key={f.id} f={f} onNavigateToStep={onNavigateToStep} onDismiss={readOnly ? null : onDismiss} busy={busy === `dismiss_finding:${f.id}`}
                onOverrule={mayOverrule ? onOverrule : null} overruleMin={overruleMin} overruleBusy={busy === 'overrule_findings'} />)}
            </ul>
          </div>
        );
      })}
    </div>
  );
}
