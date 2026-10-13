import React from 'react';
import { cn } from '@/lib/utils';

const PILL = {
  green: 'bg-emerald-100 text-emerald-800',
  amber: 'bg-amber-100 text-amber-800',
  red: 'bg-red-100 text-red-800',
  gray: 'bg-muted text-muted-foreground',
};

const SOURCE = { api: 'API', psd2: 'PSD2', upload: 'Upload', manual: 'Manual' };

export default function ConnectionsTable({ rows }) {
  return (
    <section className="bg-card border border-border rounded-lg">
      <div className="px-4 py-3 border-b border-border">
        <h2 className="text-sm font-semibold">Connections</h2>
        <p className="text-xs text-muted-foreground">How each account's data reaches Vitauri</p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-xs text-muted-foreground">
            <tr className="border-b border-border">
              <th className="text-left font-medium px-4 py-2">Customer</th>
              <th className="text-left font-medium px-4 py-2">Source</th>
              <th className="text-left font-medium px-4 py-2">Status</th>
              <th className="text-left font-medium px-4 py-2">Last upload</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.map((r) => (
              <tr key={r.account.id}>
                <td className="px-4 py-2.5 whitespace-nowrap">{r.customer}</td>
                <td className="px-4 py-2.5 whitespace-nowrap">{SOURCE[r.account.source_type] || '—'}{r.conn?.partner ? ` · ${r.conn.partner}` : ''}</td>
                <td className="px-4 py-2.5">
                  <span className={cn('inline-block text-xs font-medium px-2 py-0.5 rounded-full whitespace-nowrap', PILL[r.status.tone])}>{r.status.label}</span>
                </td>
                <td className="px-4 py-2.5 whitespace-nowrap text-muted-foreground">
                  {r.lastUpload ? new Date(r.lastUpload).toLocaleDateString() : '—'}
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr><td colSpan={4} className="px-4 py-8 text-center text-sm text-muted-foreground">No connections yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}