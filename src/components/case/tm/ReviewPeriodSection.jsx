import React from 'react';
import { Link } from 'react-router-dom';
import { format } from 'date-fns';
import { toTmCase } from '@/lib/routes';
import StatusPill from '@/components/tm/kit/StatusPill';
import { cn } from '@/lib/utils';

const fmt = (n) => (n == null ? '—' : Math.round(n).toLocaleString());

function Row({ label, actual, limit, money, cur }) {
  const over = limit != null && actual != null && actual > limit;
  return (
    <tr className="border-t border-border">
      <td className="py-1.5 pr-3 text-muted-foreground">{label}</td>
      <td className={cn('py-1.5 pr-3 text-right tabular-nums', over && 'font-semibold text-red-700')}>{money ? `${cur} ` : ''}{fmt(actual)}</td>
      <td className="py-1.5 text-right tabular-nums text-muted-foreground">{limit == null ? '—' : `${money ? `${cur} ` : ''}${fmt(limit)}`}</td>
    </tr>
  );
}

function Stat({ label, value, tone }) {
  return (
    <div className="rounded-lg border border-border bg-background px-3 py-2">
      <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className={cn('text-sm font-semibold tabular-nums', tone)}>{value}</div>
    </div>
  );
}

/** "Monitoring since last review": actual vs expected per month, alerts, cases, risk trend, coverage and what is new. */
export default function ReviewPeriodSection({ period }) {
  if (!period) return null;
  const cur = period.currency;
  const p = period.profile;
  const L = p?.limits || {};
  const since = period.from ? format(new Date(period.from), 'd MMM yyyy') : '—';
  const riskFrom = period.risk?.from;
  const riskNow = period.risk?.now;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold">Monitoring since {period.basis === 'last_kyc_approval' ? 'last review' : 'the last 12 months'}</h3>
        <span className="text-xs text-muted-foreground">From {since} · {period.transactions} transaction{period.transactions === 1 ? '' : 's'}{period.unconverted ? ` · ${period.unconverted} without FX rate` : ''}</span>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <Stat label="Risk" value={`${riskFrom ? `${riskFrom.score} ${riskFrom.band}` : '—'} → ${riskNow ? `${riskNow.score} ${riskNow.band}` : '—'}`} tone={riskFrom && riskNow && riskNow.score > riskFrom.score ? 'text-red-700' : ''} />
        <Stat label="Alerts" value={`${period.alerts.total} (${period.alerts.open} open)`} tone={period.alerts.open ? 'text-amber-700' : ''} />
        <Stat label="Data gaps" value={`${period.coverage_missing_days} day${period.coverage_missing_days === 1 ? '' : 's'}`} tone={period.coverage_missing_days ? 'text-amber-700' : ''} />
        <Stat label="New" value={`${period.new_countries.length} countr${period.new_countries.length === 1 ? 'y' : 'ies'} · ${period.new_counterparties} counterpart${period.new_counterparties === 1 ? 'y' : 'ies'}`} />
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-left text-[11px] uppercase tracking-wide text-muted-foreground">
              <th className="pb-1 font-medium">Per month</th>
              <th className="pb-1 font-medium text-right">Actual (avg)</th>
              <th className="pb-1 font-medium text-right">{p ? `Expected profile v${p.version}` : 'No approved profile'}</th>
            </tr>
          </thead>
          <tbody>
            <Row label="Inbound" actual={period.per_month.inbound} limit={L.inbound} money cur={cur} />
            <Row label="Inbound transactions" actual={period.per_month.inbound_count} limit={L.inbound_count} />
            <Row label="Outbound" actual={period.per_month.outbound} limit={L.outbound} money cur={cur} />
            <Row label="Outbound abroad" actual={period.per_month.foreign_out} limit={L.foreign_out} money cur={cur} />
            <Row label="Cash" actual={period.per_month.cash} limit={L.cash} money cur={cur} />
          </tbody>
        </table>
      </div>

      {(p?.breaches?.length > 0 || p?.outside_countries?.length > 0 || period.new_countries.length > 0) && (
        <ul className="text-xs space-y-1">
          {(p?.breaches || []).map((b) => <li key={b} className="text-red-700">! {b}</li>)}
          {p?.outside_countries?.length > 0 && <li className="text-red-700">! Countries outside the expected profile: {p.outside_countries.join(', ')}</li>}
          {period.new_countries.length > 0 && <li className="text-amber-700">? New counterparty countries this period: {period.new_countries.join(', ')}</li>}
        </ul>
      )}
      {!p && <p className="text-xs text-amber-700">There is no approved expected profile yet. Record one in step 4 so monitoring can test against it.</p>}

      {period.tm_cases.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="text-muted-foreground">TM cases:</span>
          {period.tm_cases.map((c) => (
            <Link key={c.id} to={toTmCase(c.id)} className="inline-flex items-center gap-1.5 text-primary hover:underline">
              {c.case_ref || 'Case'} <StatusPill status={c.status} />
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
