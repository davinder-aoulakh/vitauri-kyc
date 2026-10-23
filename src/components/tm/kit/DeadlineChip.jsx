import React from 'react';
import { Clock, AlertTriangle } from 'lucide-react';
import { formatCountdown, HOUR } from '@/lib/tmAlerts';
import { cn } from '@/lib/utils';

/** Working days (Mon–Fri, UTC) between now and a due date. */
export function workingDaysUntil(dueIso, now = Date.now()) {
  let n = 0;
  const d = new Date(now);
  const end = new Date(dueIso).getTime();
  while (true) {
    d.setUTCDate(d.getUTCDate() + 1);
    if (d.getTime() > end) break;
    if (d.getUTCDay() !== 0 && d.getUTCDay() !== 6) n++;
  }
  return n;
}

/**
 * Deadline as a chip: "7 h left", "6 working days left", "expired 2d 3h ago", plus "expired on arrival".
 * workingDays: count working days instead of clock time (CO investigation windows).
 */
export default function DeadlineChip({ dueAt, expiredOnArrival = false, workingDays = false, now = Date.now(), className, label }) {
  if (!dueAt) return <span className={cn('text-xs text-muted-foreground', className)}>No deadline</span>;
  const ms = new Date(dueAt).getTime() - now;
  const expired = ms < 0;
  const soon = !expired && ms < 24 * HOUR;
  let text;
  if (expired) text = `expired ${formatCountdown(ms)} ago`;
  else if (workingDays) { const d = workingDaysUntil(dueAt, now); text = `${d} working day${d === 1 ? '' : 's'} left`; }
  else text = `${formatCountdown(ms)} left`;
  const Icon = expired ? AlertTriangle : Clock;
  return (
    <span className={cn('inline-flex flex-wrap items-center gap-1.5', className)} title={new Date(dueAt).toLocaleString()}>
      <span className={cn(
        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold tabular-nums',
        expired ? 'bg-red-100 text-red-700 dark:bg-red-500/20 dark:text-red-200'
          : soon ? 'bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-200'
            : 'bg-secondary text-foreground',
      )}>
        <Icon className="h-3 w-3" aria-hidden />{label ? `${label} · ` : ''}{text}
      </span>
      {expiredOnArrival && (
        <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-800 dark:bg-amber-500/20 dark:text-amber-200">expired on arrival</span>
      )}
    </span>
  );
}
