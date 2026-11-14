import React from 'react';
import { CheckCircle2, AlertTriangle, XCircle } from 'lucide-react';
import { cn } from '@/lib/utils';

const ICON = {
  pass: { Icon: CheckCircle2, cls: 'text-emerald-600' },
  warn: { Icon: AlertTriangle, cls: 'text-amber-600' },
  fail: { Icon: XCircle, cls: 'text-red-600' },
};

const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;

const fmtAmt = (n, c) => (typeof n === 'number' ? `${n.toLocaleString(undefined, { minimumFractionDigits: 2 })} ${c || ''}`.trim() : '?');

/** v2 (aml_nav_v2): adds the account check, the three balance amounts, the historical split and counterparties. */
export function buildChecks(u, { v2 = false } = {}) {
  const gaps = u.gaps || [];
  const tamper = u.tamper_signals || [];
  const rec = u.reconciles;
  const mismatch = (u.blocking || []).find((b) => b.code === 'iban_mismatch');
  const rows = (u.parsed_rows || []).filter((r) => !r.duplicate);
  const hist = u.historical_count ?? rows.filter((r) => r.historical).length;
  const cps = new Set(rows.map((r) => r.counterparty_account_id || r.counterparty_name).filter(Boolean)).size;
  const extra = !v2 ? [] : [
    mismatch
      ? { level: 'fail', label: 'Account', detail: `The statement is for ${mismatch.file_iban}, not for the selected account ${mismatch.account_iban}` }
      : { level: u.account_ref ? 'pass' : 'warn', label: 'Account', detail: u.account_ref ? `Statement account ${u.account_ref} matches` : 'No account number in the file' },
  ];
  const tail = !v2 ? [] : [
    { level: 'pass', label: 'Historical and recent', detail: `${hist} historical (stored for analysis, not screened, no alerts) · ${Math.max(0, rows.length - hist)} recent (screened)` },
    { level: 'pass', label: 'Counterparties', detail: `${cps} found` },
  ];
  const balanceDetail = v2 && typeof u.opening_balance === 'number' && typeof u.closing_balance === 'number'
    ? `Opening ${fmtAmt(u.opening_balance, u.currency)} + movements ${fmtAmt(Math.round((u.closing_balance - u.opening_balance - (u.reconcile_diff || 0)) * 100) / 100, u.currency)} = closing ${fmtAmt(u.closing_balance, u.currency)}`
    : 'Opening + movements = closing';
  return [
    ...extra,
    { level: u.extracted_count > 0 ? 'pass' : 'fail', label: 'Extraction', detail: `${plural(u.extracted_count || 0, 'row')} extracted` },
    {
      level: rec === true ? 'pass' : rec === false ? 'fail' : 'warn', label: 'Balances reconcile',
      detail: rec === true ? balanceDetail
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
    ...tail,
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

export default function StatementChecks({ upload, v2 = false }) {
  const checks = buildChecks(upload, { v2 });
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