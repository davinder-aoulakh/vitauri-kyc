import React from 'react';
import { cn } from '@/lib/utils';

export default function KpiCard({ label, value, subtitle, icon: Icon, accentColor, onClick }) {
  return (
    <div
      className={cn(
        'bg-card rounded-xl border border-border p-4 flex flex-col gap-2 relative overflow-hidden',
        onClick && 'cursor-pointer hover:shadow-md transition-shadow'
      )}
      onClick={onClick}
    >
      <div
        className="absolute top-0 left-0 w-1 h-full rounded-l-xl"
        style={{ backgroundColor: accentColor || '#1A6BFF' }}
      />
      <div className="flex items-start justify-between pl-2">
        <div>
          <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{label}</div>
          <div className="text-3xl font-bold text-foreground mt-1">{value ?? '—'}</div>
          {subtitle && (
            <div className="text-xs text-muted-foreground mt-0.5">{subtitle}</div>
          )}
        </div>
        {Icon && (
          <div className="w-9 h-9 rounded-lg bg-muted flex items-center justify-center flex-shrink-0">
            <Icon className="w-4 h-4 text-muted-foreground" />
          </div>
        )}
      </div>
    </div>
  );
}