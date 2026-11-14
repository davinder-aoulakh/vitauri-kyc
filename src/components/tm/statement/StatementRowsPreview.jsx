import React from 'react';
import { cn } from '@/lib/utils';

const PREVIEW = 20;

/** v2 (aml_nav_v2): counterparty, IBAN and reference in their own columns, and a Historical flag. */
export default function StatementRowsPreview({ rows, excluded, onToggle, v2 = false }) {
  const shown = rows.slice(0, PREVIEW);
  return (
    <div>
      <div className="text-xs font-medium mb-1.5">
        Preview <span className="text-muted-foreground font-normal">(first {shown.length} of {rows.length})</span>
      </div>
      <div className="border border-border rounded-xl overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="bg-muted/40 text-muted-foreground">
            <tr>
              <th className="text-left font-medium px-2 py-1.5">Date</th>
              {v2 ? (
                <>
                  <th className="text-right font-medium px-2 py-1.5">Amount</th>
                  <th className="text-left font-medium px-2 py-1.5">Counterparty</th>
                  <th className="text-left font-medium px-2 py-1.5">IBAN</th>
                  <th className="text-left font-medium px-2 py-1.5">Reference</th>
                </>
              ) : (
                <>
                  <th className="text-left font-medium px-2 py-1.5">Description</th>
                  <th className="text-right font-medium px-2 py-1.5">Amount</th>
                </>
              )}
              <th className="text-left font-medium px-2 py-1.5">Flags</th>
              <th className="px-2 py-1.5 text-center font-medium">Skip</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {shown.map((r) => {
              const off = r.duplicate || excluded[r.idx];
              return (
                <tr key={r.idx} className={cn(off && 'opacity-50 line-through decoration-muted-foreground/40')}>
                  <td className="px-2 py-1.5 whitespace-nowrap">{r.date}</td>
                  {!v2 && <td className="px-2 py-1.5 max-w-[180px] truncate" title={r.description}>{r.description || '—'}</td>}
                  <td className={cn('px-2 py-1.5 text-right font-mono whitespace-nowrap', r.direction === 'inbound' ? 'text-emerald-700' : 'text-foreground')}>
                    {r.direction === 'inbound' ? '+' : '−'}{Number(r.amount).toLocaleString(undefined, { minimumFractionDigits: 2 })} {r.currency}
                  </td>
                  {v2 && (
                    <>
                      <td className="px-2 py-1.5 max-w-[150px] truncate" title={r.counterparty_name || r.description}>{r.counterparty_name || '—'}</td>
                      <td className="px-2 py-1.5 font-mono whitespace-nowrap">{r.counterparty_account_id || '—'}</td>
                      <td className="px-2 py-1.5 max-w-[140px] truncate" title={r.reference || r.description}>{r.reference || '—'}</td>
                    </>
                  )}
                  <td className="px-2 py-1.5 space-x-1 whitespace-nowrap no-underline">
                    {r.duplicate && <span className="px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-800">Duplicate</span>}
                    {v2 && r.historical && !r.duplicate && <span className="px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-700">Historical</span>}
                    {r.own_transfer && <span className="px-1.5 py-0.5 rounded-full bg-blue-100 text-blue-800">Own transfer</span>}
                    {r.lifecycle === 'reversed' && <span className="px-1.5 py-0.5 rounded-full bg-red-100 text-red-800">Reversal</span>}
                  </td>
                  <td className="px-2 py-1.5 text-center">
                    <input
                      type="checkbox" aria-label={`Skip row ${r.idx + 1}`} disabled={r.duplicate}
                      checked={!!excluded[r.idx]} onChange={() => onToggle(r.idx)}
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}