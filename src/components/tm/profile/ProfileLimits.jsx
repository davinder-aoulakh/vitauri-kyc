import React from 'react';
import { format } from 'date-fns';

const fmt = (n, cur) => (n == null ? '—' : `${cur || ''} ${Number(n).toLocaleString()}`.trim());

export default function ProfileLimits({ profile }) {
  const cur = profile.currency;
  const rows = [
    ['Inbound / month', fmt(profile.inbound_max_month, cur)],
    ['Inbound count / month', profile.inbound_max_count_month ?? '—'],
    ['Outbound / month', fmt(profile.outbound_max_month, cur)],
    ['Outbound foreign / month', fmt(profile.outbound_foreign_max_month, cur)],
    ['Cash / month', fmt(profile.cash_max_month, cur)],
    ['Valid', profile.valid_until ? `until ${format(new Date(profile.valid_until), 'd MMM yyyy')}` : '—'],
  ];
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 gap-x-6 sm:grid-cols-2">
        {rows.map(([k, v]) => (
          <div key={k} className="flex justify-between border-b border-border/50 py-1.5 text-xs">
            <span className="text-muted-foreground">{k}</span>
            <span className="font-medium">{v}</span>
          </div>
        ))}
      </div>
      <div className="text-xs">
        <span className="text-muted-foreground">Countries: </span>
        {profile.allowed_countries?.length ? profile.allowed_countries.join(', ') : '—'}
      </div>
      {profile.notes && <p className="whitespace-pre-line text-xs italic text-muted-foreground">{profile.notes}</p>}
    </div>
  );
}