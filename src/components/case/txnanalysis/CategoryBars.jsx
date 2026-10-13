import React from 'react';

export default function CategoryBars({ title, data, barClass, currency }) {
  const rows = Object.entries(data || {}).sort((a, b) => b[1] - a[1]).slice(0, 8);
  const max = rows[0]?.[1] || 1;
  return (
    <div className="rounded-xl border border-border bg-card p-3">
      <h5 className="mb-2 text-xs font-semibold">{title}</h5>
      {rows.length === 0 && <p className="text-xs italic text-muted-foreground">No data</p>}
      <div className="space-y-2">
        {rows.map(([cat, amount]) => (
          <div key={cat} className="space-y-0.5">
            <div className="flex justify-between text-[11px]">
              <span className="capitalize">{cat.replace(/_/g, ' ')}</span>
              <span className="text-muted-foreground">{currency} {Math.round(amount).toLocaleString()}</span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-muted">
              <div className={`h-full rounded-full ${barClass}`} style={{ width: `${Math.max(3, (amount / max) * 100)}%` }} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}