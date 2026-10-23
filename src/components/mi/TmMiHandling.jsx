import React from 'react';

const Card = ({ title, hint, children }) => (
  <div className="bg-card border border-border rounded-xl p-4">
    <div className="mb-3">
      <div className="text-sm font-semibold">{title}</div>
      {hint && <div className="text-xs text-muted-foreground">{hint}</div>}
    </div>
    {children}
  </div>
);

const Bar = ({ pct, tone = 'bg-primary' }) => (
  <div className="h-2 w-full rounded-full bg-muted" aria-hidden="true"><div className={`h-2 rounded-full ${tone}`} style={{ width: `${Math.min(100, Math.max(0, pct))}%` }} /></div>
);
const Empty = ({ children }) => <p className="text-xs text-muted-foreground">{children}</p>;

/** Handling quality for the TM MI page: time to decision, SLA breaches by week, backlog age and false positives per scenario. */
export default function TmMiHandling({ decision, sla, backlog, fp }) {
  const maxBucket = Math.max(1, ...backlog.buckets.map((b) => b.count));
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
      <Card title="Time to decision" hint="TM cases opened this month, until the Compliance Officer's decision">
        <dl className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
          {[['Opened', decision.opened], ['Decided', decision.decided], ['Median', decision.medianDays == null ? '—' : `${decision.medianDays} d`], ['90th percentile', decision.p90Days == null ? '—' : `${decision.p90Days} d`]].map(([l, v]) => (
            <div key={l} className="rounded-lg bg-muted/40 p-2"><dt className="text-xs text-muted-foreground">{l}</dt><dd className="font-semibold tabular-nums">{v}</dd></div>
          ))}
        </dl>
        {decision.decided > 0 && <p className="mt-2 text-xs text-muted-foreground">{decision.reported} of {decision.decided} decided cases were reported to the FIU.</p>}
      </Card>

      <Card title="Alert backlog by age" hint={`Open alerts today${backlog.oldestDays != null ? ` · oldest ${backlog.oldestDays} d` : ''}`}>
        {backlog.total === 0 ? <Empty>No open alerts.</Empty> : (
          <ul className="space-y-2">
            {backlog.buckets.map((b, i) => (
              <li key={b.label} className="grid grid-cols-[6.5rem_1fr_2.5rem] items-center gap-2 text-xs">
                <span className="text-muted-foreground">{b.label}</span>
                <Bar pct={(b.count / maxBucket) * 100} tone={i >= 3 ? 'bg-destructive' : i === 2 ? 'bg-warning' : 'bg-primary'} />
                <span className="text-right tabular-nums font-medium">{b.count}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card title="Deadline breaches by week" hint="Alerts created this month, by the week their deadline fell in">
        {sla.length === 0 ? <Empty>No alerts with a deadline this month.</Empty> : (
          <table className="w-full text-xs">
            <thead><tr className="text-left text-muted-foreground"><th className="py-1 font-medium">Week of</th><th className="py-1 font-medium text-right">Due</th><th className="py-1 font-medium text-right">Breached</th><th className="py-1 pl-3 font-medium w-1/3">Share</th></tr></thead>
            <tbody className="divide-y divide-border">
              {sla.map((r) => (
                <tr key={r.week}>
                  <td className="py-1.5">{r.week}</td>
                  <td className="py-1.5 text-right tabular-nums">{r.due}</td>
                  <td className={`py-1.5 text-right tabular-nums ${r.breached ? 'font-semibold text-destructive' : ''}`}>{r.breached}</td>
                  <td className="py-1.5 pl-3"><div className="flex items-center gap-2"><Bar pct={r.pct} tone={r.breached ? 'bg-destructive' : 'bg-success'} /><span className="w-8 text-right tabular-nums">{r.pct}%</span></div></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      <Card title="False positives per scenario" hint="Alerts created this month and already handled">
        {fp.length === 0 ? <Empty>No handled alerts this month.</Empty> : (
          <table className="w-full text-xs">
            <thead><tr className="text-left text-muted-foreground"><th className="py-1 font-medium">Scenario</th><th className="py-1 font-medium text-right">Handled</th><th className="py-1 font-medium text-right">False positive</th><th className="py-1 pl-3 font-medium w-1/3">Rate</th></tr></thead>
            <tbody className="divide-y divide-border">
              {fp.map((r) => (
                <tr key={r.code}>
                  <td className="py-1.5"><span className="font-medium">{r.code}</span> <span className="text-muted-foreground">{r.name}</span></td>
                  <td className="py-1.5 text-right tabular-nums">{r.handled}</td>
                  <td className="py-1.5 text-right tabular-nums">{r.fp}</td>
                  <td className="py-1.5 pl-3"><div className="flex items-center gap-2"><Bar pct={r.pct} tone={r.pct >= 90 ? 'bg-destructive' : r.pct >= 60 ? 'bg-warning' : 'bg-success'} /><span className="w-8 text-right tabular-nums">{r.pct}%</span></div></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
