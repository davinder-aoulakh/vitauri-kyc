import React from 'react';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts';
import { format } from 'date-fns';
import { cn } from '@/lib/utils';

const COMPONENTS = [
  { key: 'kyc', label: 'KYC file', weight: '35%' },
  { key: 'behaviour', label: 'Behaviour vs profile', weight: '25%' },
  { key: 'screening', label: 'Screening', weight: '20%' },
  { key: 'alerts', label: 'Alerts', weight: '20%' },
];
const RANK = { Low: 0, Medium: 1, High: 2, Unacceptable: 3 };

/** Behaviour is the higher of two signals: deviation from the approved profile, and Didit's own transaction risk (last 30 days). */
function BehaviourDetail({ detail, onShowDiditHigh }) {
  const d = detail || {};
  return (
    <div className="mt-1 grid grid-cols-2 gap-2 text-[11px] text-muted-foreground">
      <span>Profile deviation <span className="tabular-nums font-medium text-foreground">{Math.round(d.profile ?? 0)}</span></span>
      <span>
        Didit transaction risk <span className="tabular-nums font-medium text-foreground">{Math.round(d.didit ?? 0)}</span>
        {d.didit_high_count > 0 && (
          <>
            {' · '}
            {onShowDiditHigh
              ? <button type="button" className="text-primary hover:underline" onClick={onShowDiditHigh}>{d.didit_high_count} High+</button>
              : <>{d.didit_high_count} High+</>}
          </>
        )}
      </span>
    </div>
  );
}

/** Dynamic risk explained: component scores, reasons, history, and how it compares with the KYC rating. */
export default function RiskBreakdown({ risk, kycRating, onShowDiditHigh }) {
  if (!risk) {
    return <p className="text-sm text-muted-foreground">No dynamic risk score yet. It is computed after the next alert, profile approval or nightly run.</p>;
  }
  const comps = risk.components || {};
  const diverges = kycRating && risk.band && RANK[risk.band] > RANK[kycRating];
  const history = (risk.history || []).map((h) => ({ ...h, label: h.at ? format(new Date(h.at), 'd MMM') : '' }));
  return (
    <div className="space-y-4">
      {diverges && (
        <p className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-100">
          Monitoring band {risk.band} is above the KYC rating {kycRating}. Consider an event-driven review; the KYC rating stays the legal classification until a reviewer changes it.
        </p>
      )}
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="space-y-2">
          <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">What drives the score</h4>
          {COMPONENTS.map((c) => {
            const v = comps[c.key];
            const pct = v == null ? 0 : Math.max(0, Math.min(100, v));
            return (
              <div key={c.key}>
                <div className="flex justify-between text-xs"><span>{c.label} <span className="text-muted-foreground">· weight {c.weight}</span></span><span className="tabular-nums font-medium">{v == null ? '—' : Math.round(v)}</span></div>
                <div className="mt-1 h-1.5 rounded-full bg-muted overflow-hidden">
                  <div className={cn('h-full rounded-full', pct >= 70 ? 'bg-red-500' : pct >= 50 ? 'bg-amber-500' : 'bg-emerald-500')} style={{ width: `${pct}%` }} />
                </div>
                {c.key === 'behaviour' && comps.behaviour_detail && <BehaviourDetail detail={comps.behaviour_detail} onShowDiditHigh={onShowDiditHigh} />}
              </div>
            );
          })}
          {(risk.reasons || []).length > 0 && (
            <ul className="mt-2 space-y-1 text-xs">
              {risk.reasons.slice(0, 6).map((r) => <li key={r} className="flex gap-1.5"><span className="text-muted-foreground">•</span>{r}</li>)}
            </ul>
          )}
        </div>
        <div>
          <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">Score history</h4>
          {history.length < 2 ? <p className="text-xs text-muted-foreground">Not enough history yet.</p> : (
            <div className="h-44" role="img" aria-label={`Risk score history from ${history[0].score} to ${history[history.length - 1].score}`}>
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={history} margin={{ top: 6, right: 8, left: -18, bottom: 0 }}>
                  <XAxis dataKey="label" tick={{ fontSize: 10 }} interval="preserveStartEnd" />
                  <YAxis domain={[0, 100]} tick={{ fontSize: 10 }} />
                  <ReferenceLine y={70} stroke="hsl(var(--destructive))" strokeDasharray="4 4" />
                  <Tooltip formatter={(v) => [Math.round(v), 'Score']} />
                  <Line type="monotone" dataKey="score" stroke="hsl(var(--primary))" strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
