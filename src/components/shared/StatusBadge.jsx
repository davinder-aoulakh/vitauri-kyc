import React from 'react';
import { getStatusBadgeClass, formatStatus } from '@/lib/riskColors';
import { cn } from '@/lib/utils';

export default function StatusBadge({ status, className }) {
  if (!status) return <span className="text-muted-foreground text-xs">—</span>;
  return (
    <span className={cn(
      'inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium',
      getStatusBadgeClass(status),
      className
    )}>
      {formatStatus(status)}
    </span>
  );
}