import React from 'react';
import { format } from 'date-fns';
import { cn } from '@/lib/utils';

const num = (n) => (n == null ? '—' : Math.round(n).toLocaleString('en-US'));

function Kv({ label, children, danger }) {
  return (
    <div className="rounded-lg border border-border bg-card p-3">
      <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className={cn('mt-1 text-sm font-semibold', danger ? 'text-destructive' : 'text-foreground')}>{children}</div>
    </div>
  );
}

export default function ProfileKvStrip({ data }) {
  const { profile, actual, coverage, reporting_currency: cur } = data;
  const inboundOver = profile?.inbound_max_month != null && actual.inbound > profile.inbound_max_month;
  const countOver = profile?.inbound_max_count_month != null && actual.inbound_count > profile.inbound_max_count_month;
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
      <Kv label="Expected profile">
        {profile ? <>v{profile.version}<span className="block text-xs font-normal text-muted-foreground">{profile.approved_at ? format(new Date(profile.approved_at), 'd MMM yyyy') : '—'}</span></> : 'None approved'}
      </Kv>
      <Kv label="Expected inbound / month">{profile ? `${cur} ${num(profile.inbound_max_month)}` : '—'}</Kv>
      <Kv label="Actual inbound 30 d" danger={inboundOver}>{cur} {num(actual.inbound)}</Kv>
      <Kv label="Transactions 30 d" danger={countOver}>
        {actual.inbound_count}<span className="text-xs font-normal text-muted-foreground"> (expected {profile?.inbound_max_count_month ?? '—'})</span>
      </Kv>
      <Kv label="Countries" danger={actual.new_countries.length > 0}>
        {actual.countries.length ? (
          <span className="flex flex-wrap gap-1">
            {actual.countries.map((c) => (
              <span key={c} className={cn('rounded px-1.5 py-0.5 text-xs', actual.new_countries.includes(c) ? 'bg-red-100 text-red-700' : 'bg-muted text-foreground')}>
                {c}{actual.new_countries.includes(c) ? ' · new' : ''}
              </span>
            ))}
          </span>
        ) : '—'}
      </Kv>
      <Kv label="Data coverage">{coverage.covered} of {coverage.of} days</Kv>
    </div>
  );
}