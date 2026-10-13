import React from 'react';
import { cn } from '@/lib/utils';

const STYLES = {
  approved:   'bg-emerald-50 text-emerald-700 border-emerald-200',
  proposed:   'bg-amber-50 text-amber-700 border-amber-200',
  rejected:   'bg-red-50 text-red-700 border-red-200',
  superseded: 'bg-muted text-muted-foreground border-border',
  draft:      'bg-muted text-muted-foreground border-border',
};

export default function ProfileStatusPill({ status }) {
  return (
    <span className={cn('inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold capitalize', STYLES[status] || STYLES.draft)}>
      {status}
    </span>
  );
}