import React from 'react';
import { Bar, BarChart, CartesianGrid, Cell, ReferenceLine, XAxis, YAxis } from 'recharts';
import { ChartContainer, ChartTooltip, ChartTooltipContent } from '@/components/ui/chart';

const CONFIG = { inbound: { label: 'Inbound', color: 'hsl(var(--primary))' } };

/** Monthly inbound for the last 6 months vs. the profile ceiling (dashed). Bars above the ceiling are red. */
export default function InboundChart({ monthly, ceiling, currency }) {
  const hasCeiling = ceiling != null;
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-sm font-semibold">Monthly inbound ({currency})</h3>
        {hasCeiling
          ? <span className="text-xs text-muted-foreground">Dashed line: profile ceiling {Math.round(ceiling).toLocaleString('en-US')}</span>
          : <span className="text-xs text-muted-foreground">No approved profile ceiling</span>}
      </div>
      <ChartContainer config={CONFIG} className="h-56 w-full">
        <BarChart data={monthly}>
          <CartesianGrid vertical={false} strokeDasharray="3 3" />
          <XAxis dataKey="month" tickLine={false} axisLine={false} />
          <YAxis tickLine={false} axisLine={false} width={56} />
          <ChartTooltip content={<ChartTooltipContent />} />
          <Bar dataKey="inbound" radius={4}>
            {monthly.map((m) => (
              <Cell key={m.month} fill={hasCeiling && m.inbound > ceiling ? 'hsl(var(--destructive))' : 'hsl(var(--primary))'} />
            ))}
          </Bar>
          {hasCeiling && <ReferenceLine y={ceiling} stroke="hsl(var(--destructive))" strokeDasharray="6 4" />}
        </BarChart>
      </ChartContainer>
    </div>
  );
}