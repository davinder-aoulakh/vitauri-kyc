import React, { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { useTenant } from '@/lib/tenantContext';
import AppShell from '@/components/layout/AppShell';
import { Loader2 } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend } from 'recharts';
import { cn } from '@/lib/utils';

const RISK_COLORS = { Low: '#22c55e', Medium: '#f59e0b', High: '#ef4444', Unacceptable: '#7f1d1d' };
const STATUS_COLORS = ['#3b82f6','#f59e0b','#22c55e','#ef4444','#8b5cf6','#6b7280'];

export default function MIDashboard() {
  const { currentUser } = useTenant();
  const [cases, setCases] = useState([]);
  const [clients, setClients] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => { loadData(); }, [currentUser]);

  async function loadData() {
    if (!currentUser?.tenant_id) return;
    const [casesData, clientsData] = await Promise.all([
      base44.entities.KycCase.filter({ tenant_id: currentUser.tenant_id }, '-created_date', 500),
      base44.entities.Client.filter({ tenant_id: currentUser.tenant_id }, '-created_date', 500),
    ]);
    setCases(casesData || []);
    setClients(clientsData || []);
    setLoading(false);
  }

  // Case status breakdown
  const statusBreakdown = Object.entries(
    cases.reduce((acc, c) => { acc[c.status] = (acc[c.status] || 0) + 1; return acc; }, {})
  ).map(([name, value]) => ({ name: name.replace(/_/g,' '), value }));

  // Risk breakdown (clients)
  const riskBreakdown = Object.entries(
    clients.reduce((acc, c) => { if (c.risk_classification) acc[c.risk_classification] = (acc[c.risk_classification] || 0) + 1; return acc; }, {})
  ).map(([name, value]) => ({ name, value, color: RISK_COLORS[name] || '#6b7280' }));

  // Cases by type
  const typeBreakdown = Object.entries(
    cases.reduce((acc, c) => { acc[c.case_type || 'Unknown'] = (acc[c.case_type || 'Unknown'] || 0) + 1; return acc; }, {})
  ).map(([name, value]) => ({ name: name.replace(/_/g,' '), value }));

  const kpis = [
    { label: 'Total Clients', value: clients.length },
    { label: 'Active Cases', value: cases.filter(c => !['Approved','Closed','Rejected'].includes(c.status)).length },
    { label: 'Approved Cases', value: cases.filter(c => c.status === 'Approved').length },
    { label: 'High Risk Clients', value: clients.filter(c => c.risk_classification === 'High' || c.risk_classification === 'Unacceptable').length },
  ];

  if (loading) return (
    <AppShell>
      <div className="flex items-center justify-center h-64"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>
    </AppShell>
  );

  return (
    <AppShell>
      <div className="p-6 max-w-screen-xl mx-auto space-y-6">
        <div>
          <h1 className="text-xl font-semibold">MI Dashboard</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Management information overview</p>
        </div>

        {/* KPI cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {kpis.map(k => (
            <div key={k.label} className="bg-card border border-border rounded-xl p-4">
              <div className="text-2xl font-bold text-foreground">{k.value}</div>
              <div className="text-xs text-muted-foreground mt-1">{k.label}</div>
            </div>
          ))}
        </div>

        {/* Charts row */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
          {/* Case status */}
          <div className="bg-card border border-border rounded-xl p-4 md:col-span-2">
            <div className="text-sm font-semibold mb-4">Cases by Status</div>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={statusBreakdown} margin={{ top: 0, right: 10, left: -20, bottom: 40 }}>
                <XAxis dataKey="name" tick={{ fontSize: 10 }} angle={-30} textAnchor="end" />
                <YAxis tick={{ fontSize: 10 }} allowDecimals={false} />
                <Tooltip />
                <Bar dataKey="value" fill="hsl(var(--primary))" radius={[4,4,0,0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* Risk distribution */}
          <div className="bg-card border border-border rounded-xl p-4">
            <div className="text-sm font-semibold mb-4">Client Risk Distribution</div>
            {riskBreakdown.length === 0 ? (
              <div className="flex items-center justify-center h-40 text-muted-foreground text-sm">No data</div>
            ) : (
              <ResponsiveContainer width="100%" height={220}>
                <PieChart>
                  <Pie data={riskBreakdown} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={75} label={({ name, percent }) => `${name} ${(percent*100).toFixed(0)}%`} labelLine={false} fontSize={11}>
                    {riskBreakdown.map((entry, i) => <Cell key={i} fill={entry.color} />)}
                  </Pie>
                  <Tooltip />
                </PieChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>

        {/* Case type */}
        <div className="bg-card border border-border rounded-xl p-4">
          <div className="text-sm font-semibold mb-4">Cases by Type</div>
          <div className="flex flex-wrap gap-4">
            {typeBreakdown.map((t, i) => (
              <div key={t.name} className="flex items-center gap-2">
                <div className="w-3 h-3 rounded-sm flex-shrink-0" style={{ backgroundColor: STATUS_COLORS[i % STATUS_COLORS.length] }} />
                <span className="text-sm text-foreground font-medium">{t.value}</span>
                <span className="text-xs text-muted-foreground">{t.name}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </AppShell>
  );
}