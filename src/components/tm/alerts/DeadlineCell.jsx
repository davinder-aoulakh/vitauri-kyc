import React from 'react';
import { deadlineState, formatCountdown } from '@/lib/tmAlerts';
import { cn } from '@/lib/utils';

export default function DeadlineCell({ alert, now }) {
  const s = deadlineState(alert, now);
  if (s.kind === 'none') return <span className="text-xs text-muted-foreground">No deadline</span>;
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {s.kind === 'expired' ? (
        <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-red-100 text-red-700">expired · {formatCountdown(s.ms)} ago</span>
      ) : (
        <span className={cn('text-xs font-medium tabular-nums', s.kind === 'soon' ? 'text-red-600' : 'text-foreground')}>{formatCountdown(s.ms)}</span>
      )}
      {alert.expired_on_arrival && (
        <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-amber-100 text-amber-800">expired on arrival</span>
      )}
    </div>
  );
}