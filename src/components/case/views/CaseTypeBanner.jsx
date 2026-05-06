import React from 'react';
import { AlertTriangle, RefreshCw, Zap, UserX, Info } from 'lucide-react';
import { format, differenceInDays, parseISO } from 'date-fns';
import { cn } from '@/lib/utils';

const CONFIG = {
  Onboarding: {
    icon: Info,
    color: 'bg-blue-50 border-blue-200 text-blue-800',
    iconColor: 'text-blue-500',
    label: 'Onboarding Case',
    getDetails: (kycCase, client) => [
      client?.source_channel && `Source: ${client.source_channel}`,
      kycCase.is_re_onboarding && '⚠ Re-onboarding — previous relationship exists',
      kycCase.previous_case_id && `Previous case: ${kycCase.previous_case_id}`,
    ].filter(Boolean),
  },
  Periodic_Review: {
    icon: RefreshCw,
    color: 'bg-amber-50 border-amber-200 text-amber-800',
    iconColor: 'text-amber-500',
    label: 'Periodic Review',
    getDetails: (kycCase, client) => [
      client?.last_review_date && `Last reviewed: ${format(parseISO(client.last_review_date), 'd MMM yyyy')}`,
      client?.risk_classification && `Current risk: ${client.risk_classification}`,
      client?.next_review_date && `Next due: ${format(parseISO(client.next_review_date), 'd MMM yyyy')}`,
    ].filter(Boolean),
  },
  Event_Driven_Review: {
    icon: Zap,
    color: 'bg-red-50 border-red-200 text-red-800',
    iconColor: 'text-red-500',
    label: 'Event-Driven Review',
    getDetails: (kycCase) => [
      kycCase.trigger_reason && `Trigger: ${kycCase.trigger_reason}`,
      kycCase.created_date && `Triggered: ${format(new Date(kycCase.created_date), 'd MMM yyyy')}`,
    ].filter(Boolean),
  },
  Offboarding: {
    icon: UserX,
    color: 'bg-slate-50 border-slate-200 text-slate-700',
    iconColor: 'text-slate-500',
    label: 'Offboarding Case',
    getDetails: (kycCase) => [
      kycCase.trigger_reason && `Reason: ${kycCase.trigger_reason}`,
    ].filter(Boolean),
  },
};

export default function CaseTypeBanner({ kycCase, client }) {
  const cfg = CONFIG[kycCase?.case_type];
  if (!cfg) return null;

  const Icon = cfg.icon;
  const details = cfg.getDetails(kycCase, client);

  const dueIn = kycCase.due_date
    ? differenceInDays(new Date(kycCase.due_date), new Date())
    : null;

  return (
    <div className={cn('flex items-start gap-3 rounded-lg border px-4 py-3 mb-5 text-sm', cfg.color)}>
      <Icon className={cn('w-4 h-4 mt-0.5 flex-shrink-0', cfg.iconColor)} />
      <div className="flex-1 min-w-0">
        <div className="font-semibold text-sm">{cfg.label}</div>
        {details.length > 0 && (
          <ul className="mt-1 space-y-0.5 text-xs opacity-80">
            {details.map((d, i) => <li key={i}>{d}</li>)}
          </ul>
        )}
      </div>
      {dueIn !== null && (
        <div className={cn(
          'flex-shrink-0 text-xs font-semibold px-2 py-1 rounded-full',
          dueIn < 0 ? 'bg-red-200 text-red-800' :
          dueIn <= 3 ? 'bg-amber-200 text-amber-800' :
          'bg-white/60 text-current'
        )}>
          {dueIn < 0 ? `${Math.abs(dueIn)}d overdue` : dueIn === 0 ? 'Due today' : `${dueIn}d left`}
        </div>
      )}
    </div>
  );
}