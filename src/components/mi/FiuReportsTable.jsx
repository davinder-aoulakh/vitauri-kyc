import React from 'react';
import { Link } from 'react-router-dom';
import { format } from 'date-fns';
import { cn } from '@/lib/utils';
import { reportPill } from '@/lib/tmMi';

const fmt = (iso) => (iso ? format(new Date(iso), 'd MMM yyyy HH:mm') : '—');

export default function FiuReportsTable({ reports }) {
  if (!reports.length) return <div className="flex items-center justify-center h-24 text-sm text-muted-foreground">No FIU reports this month</div>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="bg-muted/40 border-b border-border text-xs text-muted-foreground uppercase tracking-wide">
            {['Report', 'FIU', 'Type', 'Status', 'Deadline'].map((h) => <th key={h} className="text-left px-4 py-2.5">{h}</th>)}
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {reports.map((r) => {
            const pill = reportPill(r);
            return (
              <tr key={r.id} className="hover:bg-muted/20">
                <td className="px-4 py-2.5 text-xs font-medium"><Link className="text-primary hover:underline" to={`/tm/report/${r.id}`}>{r.report_ref}</Link></td>
                <td className="px-4 py-2.5 text-xs">{r.fiu_profile_code}</td>
                <td className="px-4 py-2.5 text-xs capitalize">{(r.type || '').replace('unusual_', '')}</td>
                <td className="px-4 py-2.5"><span className={cn('text-xs px-2 py-0.5 rounded-full border font-medium whitespace-nowrap', pill.tone)}>{pill.label}</span></td>
                <td className="px-4 py-2.5 text-xs text-muted-foreground tabular-nums">{fmt(r.clock?.due_at)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}