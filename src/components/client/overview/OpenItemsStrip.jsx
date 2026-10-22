import React from 'react';
import { Link } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import EdrTriggerActions from './EdrTriggerActions';
import { format } from 'date-fns';
import { Briefcase, AlertTriangle, FileText, Zap } from 'lucide-react';
import { cn } from '@/lib/utils';
import { CASE_STATUS_LABEL } from '@/lib/tmCase';
import { STATUS_LABEL as FIU_STATUS_LABEL } from '@/lib/fiuReport';

const OPEN_CASE = ['open', 'investigating', 'pending_co'];
const OPEN_ALERT = ['new', 'triaged', 'in_review', 'escalated'];
const FIU_DONE = ['received', 'accepted'];
const DAY = 86400000;

const fmt = (d) => (d ? format(new Date(d), 'd MMM yyyy HH:mm') : '—');
const label = (s) => String(s || '').replace(/_/g, ' ');

function Item({ to, icon: Icon, tone, title, children }) {
  return (
    <Link to={to} className="flex min-w-[220px] items-start gap-2 rounded-lg border border-border bg-background px-3 py-2 text-xs hover:bg-muted/50">
      <Icon className={cn('mt-0.5 h-3.5 w-3.5 flex-shrink-0', tone)} />
      <div className="min-w-0">
        <div className="truncate font-medium text-foreground">{title}</div>
        <div className="text-muted-foreground">{children}</div>
      </div>
    </Link>
  );
}

/** Open TM cases, alerts due within 24 h, FIU reports not yet received and proposed EDR triggers (Accept / Dismiss for tmWorkCase). */
export default function OpenItemsStrip({ file, clientId, showFiu }) {
  const qc = useQueryClient();
  const now = Date.now();
  const cases = (file.tm_cases || []).filter((c) => OPEN_CASE.includes(c.status));
  const alerts = (file.alerts || []).filter((a) => OPEN_ALERT.includes(a.status) && a.due_at && new Date(a.due_at).getTime() - now < DAY);
  const reports = showFiu ? (file.fiu_reports || []).filter((r) => !FIU_DONE.includes(r.status)) : [];
  const triggers = file.edr_triggers || [];
  const total = cases.length + alerts.length + reports.length + triggers.length;

  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <h3 className="mb-3 text-sm font-semibold">Open items {total > 0 && <span className="text-muted-foreground">({total})</span>}</h3>
      {total === 0 ? <p className="text-xs text-muted-foreground">Nothing open for this customer.</p> : (
        <div className="flex flex-wrap gap-2">
          {cases.map((c) => (
            <Item key={`c-${c.id}`} to={`/tm/case/${c.id}`} icon={Briefcase} tone="text-primary" title={`TM case ${c.case_ref || ''}`}>
              {CASE_STATUS_LABEL[c.status] || label(c.status)} · due {fmt(c.due_at)}
            </Item>
          ))}
          {alerts.map((a) => {
            const overdue = new Date(a.due_at).getTime() < now;
            return (
              <Item key={`a-${a.id}`} to="/tm/alerts" icon={AlertTriangle} tone={overdue ? 'text-destructive' : 'text-amber-600'} title={a.title || 'TM alert'}>
                <span className={overdue ? 'font-medium text-destructive' : ''}>{overdue ? 'Overdue' : 'Due'} {fmt(a.due_at)}</span>
              </Item>
            );
          })}
          {reports.map((r) => (
            <Item key={`r-${r.id}`} to={`/tm/report/${r.id}`} icon={FileText} tone="text-violet-600" title={r.report_ref || 'FIU report'}>
              <span className="mr-1 rounded-full border border-border bg-muted px-1.5 py-px text-[10px] font-medium text-foreground">{FIU_STATUS_LABEL[r.status] || label(r.status)}</span>
              deadline {fmt(r.due_at)}
            </Item>
          ))}
          {triggers.map((t) => (
            <div key={`t-${t.id}`} className="flex min-w-[220px] flex-col gap-2 rounded-lg border border-amber-200 bg-amber-50/40 px-3 py-2 text-xs">
              <Link to={`/client/${clientId}?tab=cases`} className="flex items-start gap-2 hover:underline">
                <Zap className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-amber-600" />
                <div className="min-w-0">
                  <div className="truncate font-medium text-foreground">EDR proposal: {label(t.trigger_type)}</div>
                  <div className="text-muted-foreground">Proposed {fmt(t.created_date)}</div>
                </div>
              </Link>
              <EdrTriggerActions trigger={t} onDone={() => qc.invalidateQueries({ queryKey: ['customer-file-overview', clientId] })} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
