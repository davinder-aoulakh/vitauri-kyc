import React from 'react';
import { Link } from 'react-router-dom';
import { Checkbox } from '@/components/ui/checkbox';
import DeadlineCell from '@/components/tm/alerts/DeadlineCell';
import AiProposalPill from '@/components/tm/alerts/AiProposalPill';
import FiuRowAction from '@/components/tm/alerts/FiuRowAction';
import { shortId, CLOSABLE_STATUSES } from '@/lib/tmAlerts';
import { cn } from '@/lib/utils';

const scoreClass = (s) => (s >= 70 ? 'text-red-600 bg-red-50' : s >= 50 ? 'text-amber-700 bg-amber-50' : 'text-muted-foreground bg-secondary');

export default function AlertsTable({ alerts, clientsById, now, selected, onToggle, onOpen, canSelect }) {
  return (
    <div className="bg-card border border-border rounded-xl overflow-x-auto">
      <table className="w-full text-sm min-w-[860px]">
        <thead>
          <tr className="text-left text-[11px] uppercase tracking-wider text-muted-foreground border-b border-border">
            {canSelect && <th className="w-10 px-3 py-3" />}
            <th className="px-3 py-3 font-semibold">Alert</th>
            <th className="px-3 py-3 font-semibold">Customer</th>
            <th className="px-3 py-3 font-semibold">Rule / signal</th>
            <th className="px-3 py-3 font-semibold">Score</th>
            <th className="px-3 py-3 font-semibold">AI proposal and reason</th>
            <th className="px-3 py-3 font-semibold">Deadline</th>
            <th className="px-3 py-3 font-semibold"><span className="sr-only">FIU report</span></th>
          </tr>
        </thead>
        <tbody>
          {alerts.map((a) => {
            const client = clientsById.get(a.client_id);
            return (
              <tr key={a.id} onClick={() => onOpen(a)} className="border-b border-border last:border-0 hover:bg-secondary/50 cursor-pointer transition-colors">
                {canSelect && (
                  <td className="px-3 py-3" onClick={(e) => e.stopPropagation()}>
                    {CLOSABLE_STATUSES.includes(a.status) && (
                      <Checkbox checked={selected.has(a.id)} onCheckedChange={() => onToggle(a.id)} aria-label={`Select ${shortId(a)}`} />
                    )}
                  </td>
                )}
                <td className="px-3 py-3 font-mono text-xs">{shortId(a)}</td>
                <td className="px-3 py-3" onClick={(e) => e.stopPropagation()}>
                  <Link to={`/client/${a.client_id}?tab=overview`} className="text-primary hover:underline">{client?.full_name || 'Customer'}</Link>
                </td>
                <td className="px-3 py-3 max-w-[260px] truncate" title={a.title}>{a.title || '—'}</td>
                <td className="px-3 py-3">
                  <span className={cn('text-xs font-semibold px-2 py-0.5 rounded-full tabular-nums', scoreClass(a.score || 0))}>{Math.round(a.score || 0)}</span>
                </td>
                <td className="px-3 py-3"><AiProposalPill alert={a} /></td>
                <td className="px-3 py-3"><DeadlineCell alert={a} now={now} /></td>
                <td className="px-3 py-3" onClick={(e) => e.stopPropagation()}><FiuRowAction alert={a} /></td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}