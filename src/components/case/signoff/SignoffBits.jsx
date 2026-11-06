import React from 'react';
import { cn } from '@/lib/utils';
import { Route, Lock, CheckCircle, Circle, Clock } from 'lucide-react';
import { reportPhaseLabel } from '@/hooks/useSignoff';

export const LEVEL_TEXT = { analyst: 'Analyst (self sign-off)', manager: 'Manager', senior: 'Senior Management' };
const RANK_TONE = { Low: 'bg-emerald-100 text-emerald-800', Medium: 'bg-amber-100 text-amber-900', High: 'bg-red-100 text-red-800', Unacceptable: 'bg-rose-200 text-rose-900' };

export function ClassChip({ existing, proposed }) {
  if (!proposed) return null;
  return (
    <span className="inline-flex items-center gap-1 text-[11px] font-semibold">
      {existing && existing !== proposed && <><span className={cn('rounded-full px-2 py-0.5', RANK_TONE[existing])}>{existing}</span><span className="text-muted-foreground">→</span></>}
      <span className={cn('rounded-full px-2 py-0.5', RANK_TONE[proposed])}>{proposed}</span>
    </span>
  );
}

/** "Route: Senior Management, because … Compliance advice is required first." */
export function RouteLine({ route }) {
  if (!route) return null;
  return (
    <div className="flex items-start gap-2 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-900">
      <Route className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
      <span>{route.reason}{route.escalated ? ' Escalated by the Manager.' : ''}</span>
    </div>
  );
}

export function Locked({ children }) {
  return (
    <div className="flex items-start gap-2 rounded-xl border border-border bg-muted/40 px-4 py-4 text-sm text-muted-foreground">
      <Lock className="mt-0.5 h-4 w-4 flex-shrink-0" /> <div>{children}</div>
    </div>
  );
}

/** Horizontal stepper: [{label, sub, state: done|current|todo}] */
export function Stepper({ items }) {
  return (
    <ol className="grid gap-2" style={{ gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))` }}>
      {items.map((it) => (
        <li key={it.label} className="space-y-1">
          <div className="flex items-center gap-1.5">
            {it.state === 'done' ? <CheckCircle className="h-4 w-4 text-emerald-600" /> : it.state === 'current' ? <Clock className="h-4 w-4 text-amber-600" /> : <Circle className="h-4 w-4 text-muted-foreground/40" />}
            <div className={cn('h-px flex-1', it.state === 'done' ? 'bg-emerald-300' : 'bg-border')} />
          </div>
          <div className="text-xs font-medium">{it.label}</div>
          <div className="text-[11px] text-muted-foreground">{it.sub}</div>
        </li>
      ))}
    </ol>
  );
}

/** Context for KycReportStep / the PDF chapter "Compliance Advice, Oversight & Decision". */
export function reportContext({ kycCase, route, advice, decisions, users }) {
  const final = (decisions || []).find((d) => ['Approved', 'Declined', 'Terminated'].includes(d.kind));
  const names = Object.fromEntries((users || []).map((u) => [u.id, u.full_name || u.email]));
  return { phaseLabel: reportPhaseLabel(kycCase, advice), route, advice, decision: final || null, names, humanActions: [] };
}

export const ADVICE_STATUS = {
  none: 'Not requested', requested: 'Requested', info_needed: 'Info needed', received: 'Received', outdated: 'Outdated',
};
