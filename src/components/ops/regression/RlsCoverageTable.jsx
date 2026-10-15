import React from 'react';
import { RLS_COVERAGE } from '@/lib/rlsCoverage';
import { cn } from '@/lib/utils';

const BADGE = {
  yes: 'bg-emerald-100 text-emerald-700',
  no: 'bg-red-100 text-red-700',
  excluded: 'bg-amber-100 text-amber-800',
};

export default function RlsCoverageTable() {
  const covered = RLS_COVERAGE.filter((r) => r.status === 'yes').length;
  return (
    <div className="bg-card border border-border rounded-xl overflow-hidden">
      <div className="px-4 py-3 border-b border-border flex items-center justify-between">
        <h2 className="font-semibold text-sm">RLS coverage</h2>
        <span className="text-xs text-muted-foreground">{covered} of {RLS_COVERAGE.length} entities have RLS</span>
      </div>
      <table className="w-full text-sm">
        <thead>
          <tr className="bg-muted/40 border-b border-border text-xs text-muted-foreground uppercase tracking-wide">
            <th className="text-left px-4 py-2.5">Entity</th>
            <th className="text-left px-4 py-2.5">RLS</th>
            <th className="text-left px-4 py-2.5">Note</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {RLS_COVERAGE.map((r) => (
            <tr key={r.name}>
              <td className="px-4 py-1.5 text-xs font-medium">{r.name}</td>
              <td className="px-4 py-1.5">
                <span className={cn('text-xs px-2 py-0.5 rounded-full font-medium', BADGE[r.status])}>{r.status === 'yes' ? 'Yes' : 'No'}</span>
              </td>
              <td className="px-4 py-1.5 text-xs text-muted-foreground">{r.note || ''}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}