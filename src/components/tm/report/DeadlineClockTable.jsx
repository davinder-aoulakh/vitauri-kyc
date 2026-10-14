import React from 'react';
import { clockRows } from '@/lib/fiuReport';
import { format } from 'date-fns';

export default function DeadlineClockTable({ report }) {
  const rows = clockRows(report);
  return (
    <section className="bg-card border border-border rounded-xl p-4">
      <h2 className="text-sm font-semibold mb-2">Deadline clock</h2>
      <table className="w-full text-sm">
        <tbody>
          {rows.map((r) => (
            <tr key={r.key} className="border-b border-border last:border-0">
              <td className="py-1.5 text-muted-foreground">{r.label}</td>
              <td className="py-1.5 tabular-nums">{format(new Date(r.at), 'dd MMM yyyy HH:mm')}</td>
              <td className="py-1.5 text-xs text-muted-foreground text-right">{r.note}</td>
            </tr>
          ))}
          {report.clock?.due_at && (
            <tr><td className="py-1.5 font-medium">Report due</td><td className="py-1.5 tabular-nums font-medium">{format(new Date(report.clock.due_at), 'dd MMM yyyy HH:mm')}</td><td /></tr>
          )}
        </tbody>
      </table>
    </section>
  );
}