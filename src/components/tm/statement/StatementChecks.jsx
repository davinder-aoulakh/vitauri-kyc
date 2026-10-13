import React from 'react';
import { CheckCircle2, AlertTriangle, XCircle } from 'lucide-react';
import { cn } from '@/lib/utils';

const ICON = {
  pass: { Icon: CheckCircle2, cls: 'text-emerald-600' },
  warn: { Icon: AlertTriangle, cls: 'text-amber-600' },
  fail: { Icon: XCircle, cls: 'text-red-600' },
};

const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;

export function buildChecks(u) {
  const gaps = u.gaps || [];
  const tamper = u.tamper_signals || [];
  const rec = u.reconciles;
  return [
    { level: u.extracted_count > 0 ? 'pass' : 'fail', label: 'Extraction', detail: `${plural(u.extracted_count || 0, 'row')} extracted` },
    {
      level: rec === true ? 'pass' : rec === false ? 'fail' : 'warn', label: 'Balances reconcile',
      detail: rec === true ? 'Opening + movements = closing'
        : rec === false ? `Off by ${u.reconcile_diff ?? '?'} ${u.currency || ''}`.trim() : 'No opening/closing balance to check',
    },
    {
      level: gaps.length ? 'warn' : 'pass', label: 'Coverage gaps',
      detail: gaps.length ? `${plural(gaps.length, 'gap')}: ${gaps.slice(0, 3).map((g) => (g.from === g.to ? g.from : `${g.from} → ${g.to}`)).join(', ')}${gaps.length > 3 ? '…' : ''}` : 'No gaps in the period',
    },
    { level: 'pass', label: 'Duplicates removed', detail: u.duplicates_removed ? `${plural(u.duplicates_removed, 'row')} already in the system, removed` : 'No duplicates' },
    { level: 'pass', label: 'Own transfers recognised', detail: `${u.own_transfers || 0} found` },
    { level: 'pass', label: 'Reversals linked', detail: `${u.reversals_linked || 0} linked to an original` },
    {
      level: tamper.length ? 'fail' : 'pass', label: 'No signs of tampering',
      detail: tamper.length ? tamper.join(' · ') : u.format === 'pdf' ? 'No inconsistencies detected' : 'Structured file, not applicable',
    },
  ];
}

export function LifecyclePills({ rows }) {
  const counts = {};
  for (const r of rows) if (!r.duplicate) counts[r.lifecycle || 'booked'] = (counts[r.lifecycle || 'booked'] || 0) + 1;
  return (
    <div className="flex flex-wrap gap-1.5">
      {Object.entries(counts).map(([k, n]) => (
        <span key={k} className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-muted text-foreground capitalize">{k} · {n}</span>
      ))}
    </div>
  );
}

export default function StatementChecks({ upload }) {
  const checks = buildChecks(upload);
  return (
    <div className="space-y-2">
      <ul className="border border-border rounded-xl divide-y divide-border" aria-label="Integrity checks">
        {checks.map((c) => {
          const { Icon, cls } = ICON[c.level];
          return (
            <li key={c.label} className="flex items-start gap-2.5 px-3 py-2">
              <Icon className={cn('w-4 h-4 mt-0.5 flex-shrink-0', cls)} aria-label={c.level} />
              <div className="min-w-0">
                <div className="text-xs font-medium">{c.label}</div>
                <div className="text-xs text-muted-foreground break-words">{c.detail}</div>
              </div>
            </li>
          );
        })}
      </ul>
      {(upload.warnings || []).map((w) => (
        <div key={w} className="flex items-start gap-2 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
          <AlertTriangle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" /> {w}
        </div>
      ))}
    </div>
  );
}