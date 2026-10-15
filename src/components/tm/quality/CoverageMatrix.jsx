import React from 'react';
import { cn } from '@/lib/utils';
import { shortDate } from '@/lib/tmQuality';

const TONE = {
  Covered: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  Partial: 'bg-amber-50 text-amber-700 border-amber-200',
  Gap: 'bg-red-50 text-red-700 border-red-200',
  'No data': 'bg-secondary text-muted-foreground border-border',
};

export const StatusPill = ({ status }) => (
  <span className={cn('inline-block text-[11px] font-medium px-2 py-0.5 rounded-full border whitespace-nowrap', TONE[status])}>{status}</span>
);

export default function CoverageMatrix({ rows }) {
  return (
    <div className="bg-card border border-border rounded-xl overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-[11px] uppercase tracking-wider text-muted-foreground border-b border-border">
            {['Risk', 'Scenario', 'Required data', 'Test', 'Owner', 'Review date', 'Status'].map((h) => <th key={h} className="px-3 py-2.5 font-semibold">{h}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.scenario.id} className="border-b border-border last:border-0 align-top">
              <td className="px-3 py-2.5">{r.risk ? `${r.risk.code} · ${r.risk.name}` : '—'}</td>
              <td className="px-3 py-2.5 font-medium">{r.scenario.code} · {r.scenario.name}</td>
              <td className="px-3 py-2.5 text-muted-foreground">{r.scenario.required_data?.length ? r.scenario.required_data.join(', ') : '—'}</td>
              <td className="px-3 py-2.5 text-xs">{r.test ? <>{r.test.label}<div className="text-muted-foreground">{shortDate(r.test.at)}</div></> : <span className="text-muted-foreground">No test yet</span>}</td>
              <td className="px-3 py-2.5 text-muted-foreground">{r.owner || '—'}</td>
              <td className="px-3 py-2.5 text-muted-foreground tabular-nums">{shortDate(r.reviewDate)}</td>
              <td className="px-3 py-2.5"><StatusPill status={r.status} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}