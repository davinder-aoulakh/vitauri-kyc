import React, { useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';

function Pill({ ok, label }) {
  if (ok === null || ok === undefined) return <span className="text-xs text-muted-foreground">n/a</span>;
  return (
    <span className={cn('text-xs px-2 py-0.5 rounded-full font-medium', ok ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700')}>
      {label || (ok ? 'Pass' : 'Fail')}
    </span>
  );
}

function Mode({ title, data }) {
  return (
    <div className="flex-1 min-w-[260px]">
      <div className="text-xs font-semibold mb-1">{title} {data?.http_status ? <span className="text-muted-foreground font-normal">(HTTP {data.http_status})</span> : null}</div>
      {data?.error && <div className="text-xs text-red-600 mb-1">{data.error}</div>}
      <div className="text-[11px] text-muted-foreground">Expected</div>
      <pre className="text-[11px] bg-muted/40 rounded p-2 overflow-x-auto">{JSON.stringify(data?.expected, null, 1)}</pre>
      <div className="text-[11px] text-muted-foreground mt-1">Actual snapshot</div>
      <pre className="text-[11px] bg-muted/40 rounded p-2 overflow-x-auto">{JSON.stringify(data?.snapshot, null, 1)}</pre>
      {data?.diffs?.length > 0 && (
        <ul className="mt-1 text-xs text-red-600 list-disc pl-4">
          {data.diffs.map((d) => <li key={d.field}>{d.field}: expected {JSON.stringify(d.expected)}, got {JSON.stringify(d.actual)}</li>)}
        </ul>
      )}
    </div>
  );
}

export default function ResultsTable({ results }) {
  const [open, setOpen] = useState(null);
  return (
    <div className="bg-card border border-border rounded-xl overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-muted/40 border-b border-border text-xs text-muted-foreground uppercase tracking-wide">
              <th className="text-left px-4 py-2.5">Fixture</th>
              <th className="text-left px-4 py-2.5">tm_core OFF</th>
              <th className="text-left px-4 py-2.5">tm_core ON</th>
              <th className="text-left px-4 py-2.5">OFF = ON</th>
              <th className="text-left px-4 py-2.5">Result</th>
              <th className="px-4 py-2.5" />
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {results.map((r) => (
              <React.Fragment key={r.fixture_id}>
                <tr className="hover:bg-muted/20 cursor-pointer" onClick={() => setOpen(open === r.fixture_id ? null : r.fixture_id)}>
                  <td className="px-4 py-2 text-xs font-medium">{r.name}</td>
                  <td className="px-4 py-2"><Pill ok={r.off?.diffs?.length === 0 && !r.off?.error} /></td>
                  <td className="px-4 py-2"><Pill ok={r.on?.diffs?.length === 0 && !r.on?.error} /></td>
                  <td className="px-4 py-2"><Pill ok={r.identical_ok} /></td>
                  <td className="px-4 py-2">{r.skipped ? <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-muted text-muted-foreground">Skipped: not configured</span> : <Pill ok={r.pass} />}</td>
                  <td className="px-4 py-2"><ChevronDown className={cn('w-4 h-4 text-muted-foreground transition-transform', open === r.fixture_id && 'rotate-180')} /></td>
                </tr>
                {open === r.fixture_id && (
                  <tr><td colSpan={6} className="px-4 py-3 bg-muted/20"><div className="flex flex-wrap gap-4"><Mode title="tm_core OFF" data={r.off} /><Mode title="tm_core ON" data={r.on} /></div></td></tr>
                )}
              </React.Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}