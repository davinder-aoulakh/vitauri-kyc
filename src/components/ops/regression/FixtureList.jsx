import React from 'react';

export default function FixtureList({ fixtures }) {
  return (
    <div className="bg-card border border-border rounded-xl overflow-hidden">
      <div className="px-4 py-3 border-b border-border flex items-center justify-between">
        <h2 className="font-semibold text-sm">Stored fixtures</h2>
        <span className="text-xs text-muted-foreground">{fixtures.length} fixtures</span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-muted/40 border-b border-border text-xs text-muted-foreground uppercase tracking-wide">
              <th className="text-left px-4 py-2.5">#</th>
              <th className="text-left px-4 py-2.5">Name</th>
              <th className="text-left px-4 py-2.5">Webhook type</th>
              <th className="text-left px-4 py-2.5">Status in payload</th>
              <th className="text-left px-4 py-2.5">Notes</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {fixtures.map((f) => (
              <tr key={f.id}>
                <td className="px-4 py-2 text-xs tabular-nums">{f.order}</td>
                <td className="px-4 py-2 text-xs font-medium">{f.name}</td>
                <td className="px-4 py-2 text-xs font-mono">{f.webhook_type}</td>
                <td className="px-4 py-2 text-xs">{f.payload?.status || '—'}</td>
                <td className="px-4 py-2 text-xs text-muted-foreground">{f.notes}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}