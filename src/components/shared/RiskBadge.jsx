import React from 'react';
import { getRiskBadgeClass } from '@/lib/riskColors';
import { cn } from '@/lib/utils';

export default function RiskBadge({ risk, className }) {
  if (!risk) return <span className="text-muted-foreground text-xs">—</span>;
  return (
    <span className={cn(
      'inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border',
      getRiskBadgeClass(risk),
      className
    )}>
      {risk}
    </span>
  );
}