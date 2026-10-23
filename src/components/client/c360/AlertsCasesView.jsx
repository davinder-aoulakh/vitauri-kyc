import React, { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { format } from 'date-fns';
import { toAlert, toKycCase, toReport, toTmCase } from '@/lib/routes';
import StatusPill from '@/components/tm/kit/StatusPill';
import DeadlineChip from '@/components/tm/kit/DeadlineChip';
import EmptyState from '@/components/shared/EmptyState';
import { AlertTriangle, Briefcase, FolderOpen, FileText, Zap, Inbox } from 'lucide-react';
import { cn } from '@/lib/utils';

const OPEN_ALERT = ['new', 'triaged', 'in_review', 'escalated'];
const OPEN_TM = ['open', 'investigating', 'pending_co', 'decided_report'];
const OPEN_KYC = ['Draft', 'In_Progress', 'Outreach_Pending', 'Screening', 'Assessment', 'QC', 'Compliance_Review', 'Sign_Off_Pending'];
const KIND = {
  alert: { icon: AlertTriangle, tone: 'text-amber-600', label: 'TM alert' },
  tm_case: { icon: Briefcase, tone: 'text-primary', label: 'TM case' },
  kyc_case: { icon: FolderOpen, tone: 'text-sky-600', label: 'KYC case' },
  edr: { icon: Zap, tone: 'text-violet-600', label: 'Review proposal' },
  fiu: { icon: FileText, tone: 'text-purple-600', label: 'FIU report' },
};
const label = (s) => String(s || '').replace(/_/g, ' ');

/** Everything that happened or is open for this customer, KYC and TM together, in one list. FIU only for readers. */
export default function AlertsCasesView({ file, showFiu }) {
  const [onlyOpen, setOnlyOpen] = useState(true);
  const rows = useMemo(() => {
    if (!file) return [];
    const out = [];
    (file.alerts || []).forEach((a) => out.push({ kind: 'alert', id: a.id, title: a.title || 'Alert', status: a.status, due_at: a.due_at, at: a.created_date, open: OPEN_ALERT.includes(a.status), to: toAlert(a.id), extra: a.score != null ? `score ${Math.round(a.score)}` : null }));
    (file.tm_cases || []).forEach((c) => out.push({ kind: 'tm_case', id: c.id, title: c.case_ref || 'TM case', status: c.status, due_at: c.due_at, at: null, open: OPEN_TM.includes(c.status), to: toTmCase(c.id), extra: `${c.alert_ids_count} alert${c.alert_ids_count === 1 ? '' : 's'}` }));
    (file.kyc_cases || []).forEach((k) => out.push({ kind: 'kyc_case', id: k.id, title: label(k.case_type), status: k.status, due_at: null, at: k.created_date, open: OPEN_KYC.includes(k.status), to: toKycCase(k.id), extra: k.risk_classification ? `risk ${k.risk_classification}` : null }));
    (file.edr_triggers || []).forEach((t) => out.push({ kind: 'edr', id: t.id, title: label(t.trigger_type), status: 'proposed', due_at: null, at: t.created_date, open: true, to: null, extra: 'accept or dismiss under Overview' }));
    if (showFiu) (file.fiu_reports || []).forEach((r) => out.push({ kind: 'fiu', id: r.id, title: r.report_ref || 'FIU report', status: r.status, due_at: r.due_at, at: null, open: !['received', 'accepted', 'rejected'].includes(r.status), to: toReport(r.id), extra: r.fiu_reference ? `FIU ref ${r.fiu_reference}` : null }));
    return out.sort((a, b) => Number(b.open) - Number(a.open) || String(b.at || b.due_at || '').localeCompare(String(a.at || a.due_at || '')));
  }, [file, showFiu]);
  const shown = onlyOpen ? rows.filter((r) => r.open) : rows;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">{rows.filter((r) => r.open).length} open · {rows.length} total</p>
        <div className="flex gap-1">
          {[[true, 'Open'], [false, 'All']].map(([v, l]) => (
            <button key={l} type="button" onClick={() => setOnlyOpen(v)} className={cn('px-2.5 py-1 rounded-full text-xs border', onlyOpen === v ? 'bg-primary text-primary-foreground border-primary' : 'border-border text-muted-foreground')}>{l}</button>
          ))}
        </div>
      </div>
      {shown.length === 0 ? <EmptyState icon={Inbox} title={onlyOpen ? 'Nothing open' : 'Nothing yet'} description="Alerts, cases, review proposals and reports for this customer appear here." /> : (
        <ul className="bg-card border border-border rounded-xl divide-y divide-border">
          {shown.map((r) => {
            const K = KIND[r.kind];
            const body = (
              <div className="flex items-center gap-3 px-4 py-2.5">
                <K.icon className={cn('w-4 h-4 flex-shrink-0', K.tone)} aria-hidden />
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium truncate">{r.title}</div>
                  <div className="text-[11px] text-muted-foreground">{K.label}{r.extra ? ` · ${r.extra}` : ''}{r.at ? ` · ${format(new Date(r.at), 'd MMM yyyy')}` : ''}</div>
                </div>
                <StatusPill status={r.status} />
                <div className="w-40 flex justify-end">{r.open && r.due_at ? <DeadlineChip dueAt={r.due_at} /> : null}</div>
              </div>
            );
            return <li key={`${r.kind}-${r.id}`}>{r.to ? <Link to={r.to} className="block hover:bg-secondary/40">{body}</Link> : body}</li>;
          })}
        </ul>
      )}
    </div>
  );
}
