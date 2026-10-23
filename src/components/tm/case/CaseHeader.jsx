import React from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, Clock } from 'lucide-react';
import { cn } from '@/lib/utils';
import StatusPill from '@/components/tm/kit/StatusPill';
import { toClient, toTmCases } from '@/lib/routes';

const nameOf = (users, id) => (users || []).find((u) => u.id === id)?.full_name || (id ? 'Unknown user' : 'Not set');

function Meta({ label, value }) {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="text-sm font-medium text-foreground">{value}</div>
    </div>
  );
}

export default function CaseHeader({ tmCase, users, client, pill }) {
  return (
    <div className="mb-5 space-y-3">
      <nav aria-label="Breadcrumb" className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Link to={toTmCases()} className="inline-flex items-center gap-1 hover:text-foreground"><ArrowLeft className="w-3.5 h-3.5" /> Cases</Link>
        {client && <><span aria-hidden>/</span><Link to={toClient(client.id)} className="hover:text-foreground">{client.full_name}</Link></>}
      </nav>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-xl font-semibold">{tmCase.case_ref || 'Case'}</h1>
            <StatusPill status={tmCase.status} />
          </div>
          <p className="text-sm text-muted-foreground mt-0.5">{tmCase.title || 'Untitled case'}{client && <> · <Link to={toClient(client.id)} className="text-primary hover:underline">{client.full_name}</Link></>}</p>
        </div>
        {pill && (
          <span className={cn('inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-full border',
            pill.overdue ? 'bg-red-50 text-red-700 border-red-200' : 'bg-amber-50 text-amber-800 border-amber-200')}>
            <Clock className="w-3.5 h-3.5" /> {pill.text}
          </span>
        )}
      </div>
      <div className="flex flex-wrap gap-x-8 gap-y-2 bg-card border border-border rounded-xl px-4 py-3">
        <Meta label="Assigned to" value={nameOf(users, tmCase.assigned_to_user_id)} />
        <Meta label="Four-eyes reviewer" value={nameOf(users, tmCase.four_eyes_user_id)} />
        <Meta label="Clients" value={`${(tmCase.client_ids || []).length || 1}`} />
      </div>
    </div>
  );
}