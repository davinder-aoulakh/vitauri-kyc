import React from 'react';
import { cn } from '@/lib/utils';

/**
 * Dark navy hero band with a radial light-blue glow, used behind KPI rows
 * on Dashboard / Ops Console. Purely visual — no data logic.
 */
export default function HeroBand({ children, className }) {
  return (
    <div
      className={cn(
        'relative overflow-hidden rounded-[14px] border border-sidebar-border bg-sidebar p-5 animate-tech-rise motion-reduce:animate-none',
        className
      )}
    >
      <div
        className="absolute inset-0 pointer-events-none"
        style={{ background: 'radial-gradient(ellipse at 85% 10%, hsl(var(--hero-glow)) 0%, transparent 55%)' }}
      />
      <div className="relative z-10">{children}</div>
    </div>
  );
}