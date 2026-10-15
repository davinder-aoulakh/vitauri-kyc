import React from 'react';

const fmt = (v) => (v == null ? '—' : Number(v).toLocaleString('en-US', { maximumSignificantDigits: 6 }));

export default function FxRatesTable({ status }) {
  if (!status.currencies.length) return <p className="text-xs text-muted-foreground">No foreign-currency transactions yet.</p>;
  return (
    <div className="max-h-72 overflow-auto rounded-lg border border-border">
      <table className="w-full text-xs">
        <thead className="sticky top-0 bg-muted">
          <tr>
            <th className="px-3 py-2 text-left font-medium">Date</th>
            {status.currencies.map((c) => <th key={c} className="px-3 py-2 text-right font-medium">{c} → {status.reporting_currency}</th>)}
          </tr>
        </thead>
        <tbody>
          {status.table.map((row) => (
            <tr key={row.date} className="border-t border-border">
              <td className="px-3 py-1.5 font-mono">{row.date}</td>
              {status.currencies.map((c) => (
                <td key={c} className={`px-3 py-1.5 text-right font-mono ${row.rates[c] == null ? 'text-amber-700' : ''}`}>{fmt(row.rates[c])}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}