import React from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer, LineChart, Line, CartesianGrid } from 'recharts';

const COLORS = ['#3b82f6', '#22c55e', '#f59e0b', '#8b5cf6', '#ef4444', '#14b8a6', '#f97316', '#6b7280'];
const Empty = () => <div className="flex items-center justify-center h-40 text-muted-foreground text-sm">No data for this month</div>;

export function AlertsPerWeekChart({ data, codes }) {
  if (!data.length) return <Empty />;
  return (
    <ResponsiveContainer width="100%" height={220}>
      <BarChart data={data} margin={{ top: 0, right: 10, left: -20, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
        <XAxis dataKey="week" tick={{ fontSize: 10 }} />
        <YAxis tick={{ fontSize: 10 }} allowDecimals={false} />
        <Tooltip />
        <Legend wrapperStyle={{ fontSize: 11 }} />
        {codes.map((c, i) => <Bar key={c} dataKey={c} stackId="a" fill={COLORS[i % COLORS.length]} />)}
      </BarChart>
    </ResponsiveContainer>
  );
}

export function CoverageChart({ data }) {
  if (!data.length) return <Empty />;
  return (
    <ResponsiveContainer width="100%" height={220}>
      <LineChart data={data} margin={{ top: 5, right: 20, left: -20, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
        <XAxis dataKey="week" tick={{ fontSize: 10 }} />
        <YAxis tick={{ fontSize: 10 }} domain={[0, 100]} unit="%" />
        <Tooltip formatter={(v) => [`${v}%`, 'Coverage']} />
        <Line type="monotone" dataKey="coverage" stroke="hsl(var(--primary))" strokeWidth={2} dot={{ r: 3 }} />
      </LineChart>
    </ResponsiveContainer>
  );
}