import React from 'react';
import { format } from 'date-fns';
import { Activity, AlertTriangle, ClipboardCheck, ShieldCheck, Target } from 'lucide-react';
import EmptyState from '@/components/shared/EmptyState';

const ICONS = { kyc_signoff: ClipboardCheck, profile: Target, alert: AlertTriangle, risk: Activity, audit: ShieldCheck };

export default function MonitoringTimeline({ items }) {
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <h3 className="mb-3 text-sm font-semibold">Timeline</h3>
      {items.length === 0 ? <EmptyState title="No events yet" /> : (
        <ul className="max-h-96 space-y-3 overflow-y-auto pr-1">
          {items.map((it, i) => {
            const Icon = ICONS[it.kind] || Activity;
            return (
              <li key={i} className="flex gap-3">
                <div className="mt-0.5 flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-muted"><Icon className="h-3.5 w-3.5 text-muted-foreground" /></div>
                <div className="min-w-0 text-xs">
                  <div className="font-medium capitalize text-foreground">{it.title}</div>
                  {it.detail && <div className="truncate text-muted-foreground">{it.detail}</div>}
                  <div className="text-[11px] text-muted-foreground">{format(new Date(it.at), 'd MMM yyyy HH:mm')}</div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}