import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import { useTenant } from '@/lib/tenantContext';
import AppShell from '@/components/layout/AppShell';
import PageHeader from '@/components/shared/PageHeader';
import { Button } from '@/components/ui/button';
import {
  PieChart, Pie, Cell, Tooltip, ResponsiveContainer, Legend,
  BarChart, Bar, XAxis, YAxis, CartesianGrid, LabelList,
  RadarChart, Radar, PolarGrid, PolarAngleAxis,
} from 'recharts';
import { Loader2, AlertTriangle, RefreshCw, ChevronRight, TrendingUp, Users, Shield, Activity } from 'lucide-react';
import { format, subMonths, startOfMonth, endOfMonth, isWithinInterval } from 'date-fns';
import { cn } from '@/lib/utils';


const RISK_COLORS = { Low: '#22c55e', Medium: '#f59e0b', High: '#ef4444', Unacceptable: '#881337' };
const RISK_ORDER  = ['Low', 'Medium', 'High', 'Unacceptable'];

function StatCard({ label, value, sub, color = 'text-foreground', onClick }) {
  return (
    <div
      className={cn('bg-card border border-border rounded-xl p-4', onClick && 'cursor-pointer hover:bg-muted/30 transition-colors')}
      onClick={onClick}
    >
      <div className={cn('text-2xl font-bold tabular-nums', color)}>{value}</div>
      <div className="text-sm font-medium text-foreground mt-0.5">{label}</div>
      {sub && <div className="text-xs text-muted-foreground mt-0.5">{sub}</div>}
    </div>
  );
}

export default function RiskDashboard() {
  const { currentUser } = useTenant();
  const navigate = useNavigate();
  const [clients, setClients]   = useState([]);
  const [cases, setCases]       = useState([]);
  const [riskAssessments, setRiskAssessments] = useState([]);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState(null);
  const [riskFilter, setRiskFilter] = useState('all');

  useEffect(() => { if (currentUser?.tenant_id) loadData(); }, [currentUser?.tenant_id]);

  async function loadData() {
    setLoading(true);
    setError(null);
    try {
      const [clientsData, casesData, assessmentsData] = await Promise.all([
        base44.entities.Client.filter({ tenant_id: currentUser.tenant_id }, '-created_date', 1000),
        base44.entities.KycCase.filter({ tenant_id: currentUser.tenant_id }, '-created_date', 1000),
        base44.entities.RiskAssessment.filter({ tenant_id: currentUser.tenant_id }, '-created_date', 1000),
      ]);
      setClients(clientsData || []);
      setCases(casesData || []);
      setRiskAssessments(assessmentsData || []);
    } catch (err) {
      setError(err?.message || 'Failed to load risk data');
    } finally {
      setLoading(false);
    }
  }

  // ── Computations ────────────────────────────────────────────────────────────
  const activeClients = useMemo(() => clients.filter(c => !c.is_deleted && c.status !== 'Former'), [clients]);

  const clientsByRisk = useMemo(() =>
    RISK_ORDER.map(r => ({
      name: r,
      value: activeClients.filter(c => c.risk_classification === r).length,
      color: RISK_COLORS[r],
    })).filter(r => r.value > 0),
  [activeClients]);

  const casesByRisk = useMemo(() =>
    RISK_ORDER.map(r => ({
      name: r,
      value: cases.filter(c => c.risk_classification === r).length,
      color: RISK_COLORS[r],
    })).filter(r => r.value > 0),
  [cases]);

  // Risk movement: cases closed this year, compare case risk to prior client risk
  const riskTrend = useMemo(() => {
    const months = Array.from({ length: 6 }, (_, i) => {
      const d = subMonths(new Date(), 5 - i);
      return { month: format(d, 'MMM yy'), start: startOfMonth(d), end: endOfMonth(d), Low: 0, Medium: 0, High: 0, Unacceptable: 0 };
    });
    cases.filter(c => c.risk_classification && c.created_date).forEach(c => {
      const d = new Date(c.created_date);
      const m = months.find(m => isWithinInterval(d, { start: m.start, end: m.end }));
      if (m && RISK_ORDER.includes(c.risk_classification)) m[c.risk_classification]++;
    });
    return months;
  }, [cases]);

  // Risk score distribution from RiskAssessment records
  const assessmentScoreBreakdown = useMemo(() => {
    const counts = { Low: 0, Medium: 0, High: 0, Unacceptable: 0 };
    riskAssessments.forEach(a => { if (counts[a.score] !== undefined) counts[a.score]++; });
    return RISK_ORDER.map(r => ({ name: r, value: counts[r], color: RISK_COLORS[r] })).filter(r => r.value > 0);
  }, [riskAssessments]);

  // Top risk indicators (most frequently triggered)
  const topIndicators = useMemo(() => {
    const counts = {};
    riskAssessments.forEach(a => {
      if (!a.indicator_name) return;
      counts[a.indicator_name] = (counts[a.indicator_name] || 0) + 1;
    });
    return Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([name, count]) => ({ name: name.length > 30 ? name.slice(0, 28) + '…' : name, count }));
  }, [riskAssessments]);

  // Radar: risk profile by client type
  const radarData = useMemo(() => {
    return RISK_ORDER.map(r => ({
      risk: r,
      NP: activeClients.filter(c => c.client_type === 'NP' && c.risk_classification === r).length,
      ORG: activeClients.filter(c => c.client_type === 'ORG' && c.risk_classification === r).length,
    }));
  }, [activeClients]);

  // Filtered client list for drilldown
  const filteredClients = useMemo(() =>
    riskFilter === 'all' ? activeClients : activeClients.filter(c => c.risk_classification === riskFilter),
  [activeClients, riskFilter]);

  // Totals
  const highRiskCount  = activeClients.filter(c => c.risk_classification === 'High').length;
  const unacceptable   = activeClients.filter(c => c.risk_classification === 'Unacceptable').length;
  const unclassified   = activeClients.filter(c => !c.risk_classification).length;

  if (loading) return (
    <AppShell>
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
      </div>
    </AppShell>
  );

  if (error) return (
    <AppShell>
      <div className="flex items-center justify-center h-64">
        <div className="text-center space-y-3">
          <AlertTriangle className="w-8 h-8 text-destructive mx-auto" />
          <p className="text-sm text-muted-foreground">{error}</p>
          <Button size="sm" variant="outline" onClick={loadData}>Retry</Button>
        </div>
      </div>
    </AppShell>
  );

  return (
    <AppShell>
      <div className="p-6 max-w-screen-2xl mx-auto space-y-6">
        <PageHeader
          title="Risk Dashboard"
          subtitle="Aggregated risk profile across the full client portfolio"
          actions={
            <Button size="sm" variant="outline" className="gap-1.5 text-xs" onClick={loadData}>
              <RefreshCw className="w-3.5 h-3.5" /> Refresh
            </Button>
          }
        />

        {/* ── KPI Row ── */}
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-4 gap-4">
          <StatCard label="Active Clients" value={activeClients.length} sub="Total in portfolio" color="text-foreground" />
          <StatCard label="High Risk" value={highRiskCount} sub="Active clients" color="text-red-600"
            onClick={() => setRiskFilter(riskFilter === 'High' ? 'all' : 'High')} />
          <StatCard label="Unacceptable Risk" value={unacceptable} sub="Requires immediate action" color="text-rose-800"
            onClick={() => setRiskFilter(riskFilter === 'Unacceptable' ? 'all' : 'Unacceptable')} />
          <StatCard label="Unclassified" value={unclassified} sub="No risk assigned yet" color="text-muted-foreground" />
        </div>

        {/* ── Row 1: Client Risk Pie + Case Risk Pie ── */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          {/* Client portfolio risk */}
          <div className="bg-card border border-border rounded-xl p-5">
            <div className="flex items-center gap-2 mb-4">
              <Users className="w-4 h-4 text-muted-foreground" />
              <span className="text-sm font-semibold">Client Portfolio by Risk Class</span>
            </div>
            {clientsByRisk.length === 0 ? (
              <div className="flex items-center justify-center h-48 text-muted-foreground text-sm">No risk classifications assigned</div>
            ) : (
              <div className="flex gap-4 items-center">
                <ResponsiveContainer width="60%" height={220}>
                  <PieChart>
                    <Pie data={clientsByRisk} dataKey="value" nameKey="name" cx="50%" cy="50%"
                      innerRadius={55} outerRadius={90}
                      paddingAngle={2}
                      label={({ name, percent }) => `${(percent * 100).toFixed(0)}%`}
                      labelLine={false} fontSize={11}>
                      {clientsByRisk.map((e, i) => <Cell key={i} fill={e.color} />)}
                    </Pie>
                    <Tooltip formatter={(v, n) => [v, n]} />
                  </PieChart>
                </ResponsiveContainer>
                <div className="flex flex-col gap-2 flex-1">
                  {clientsByRisk.map(r => (
                    <button
                      key={r.name}
                      onClick={() => setRiskFilter(riskFilter === r.name ? 'all' : r.name)}
                      className={cn(
                        'flex items-center gap-2.5 px-3 py-2 rounded-lg border text-left transition-colors',
                        riskFilter === r.name ? 'border-primary bg-primary/5' : 'border-border hover:bg-muted/30'
                      )}
                    >
                      <span className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: r.color }} />
                      <span className="text-xs font-medium flex-1">{r.name}</span>
                      <span className="text-sm font-bold tabular-nums" style={{ color: r.color }}>{r.value}</span>
                    </button>
                  ))}
                  {unclassified > 0 && (
                    <div className="flex items-center gap-2.5 px-3 py-2 rounded-lg border border-border">
                      <span className="w-3 h-3 rounded-full bg-slate-300 flex-shrink-0" />
                      <span className="text-xs font-medium flex-1 text-muted-foreground">Unclassified</span>
                      <span className="text-sm font-bold tabular-nums text-muted-foreground">{unclassified}</span>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Case risk breakdown */}
          <div className="bg-card border border-border rounded-xl p-5">
            <div className="flex items-center gap-2 mb-4">
              <Shield className="w-4 h-4 text-muted-foreground" />
              <span className="text-sm font-semibold">Cases by Risk Classification</span>
            </div>
            {casesByRisk.length === 0 ? (
              <div className="flex items-center justify-center h-48 text-muted-foreground text-sm">No cases with risk classifications</div>
            ) : (
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={casesByRisk} margin={{ top: 5, right: 10, left: -20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="name" tick={{ fontSize: 12 }} />
                  <YAxis tick={{ fontSize: 10 }} allowDecimals={false} />
                  <Tooltip formatter={(v) => [v, 'Cases']} />
                  <Bar dataKey="value" radius={[6, 6, 0, 0]}>
                    <LabelList dataKey="value" position="top" style={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }} />
                    {casesByRisk.map((e, i) => <Cell key={i} fill={e.color} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>

        {/* ── Row 2: Risk Trend + NP vs ORG Radar ── */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
          <div className="lg:col-span-2 bg-card border border-border rounded-xl p-5">
            <div className="flex items-center gap-2 mb-4">
              <TrendingUp className="w-4 h-4 text-muted-foreground" />
              <span className="text-sm font-semibold">Risk Distribution Over Time (Cases — last 6 months)</span>
            </div>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={riskTrend} margin={{ top: 0, right: 10, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="month" tick={{ fontSize: 10 }} />
                <YAxis tick={{ fontSize: 10 }} allowDecimals={false} />
                <Tooltip />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                {RISK_ORDER.map(r => (
                  <Bar key={r} dataKey={r} stackId="a" fill={RISK_COLORS[r]} radius={r === 'Unacceptable' ? [4, 4, 0, 0] : [0, 0, 0, 0]} />
                ))}
              </BarChart>
            </ResponsiveContainer>
          </div>

          <div className="bg-card border border-border rounded-xl p-5">
            <div className="flex items-center gap-2 mb-4">
              <Activity className="w-4 h-4 text-muted-foreground" />
              <span className="text-sm font-semibold">Risk Profile: NP vs ORG</span>
            </div>
            <ResponsiveContainer width="100%" height={220}>
              <RadarChart data={radarData}>
                <PolarGrid />
                <PolarAngleAxis dataKey="risk" tick={{ fontSize: 11 }} />
                <Radar name="NP (Individual)" dataKey="NP" stroke="#3b82f6" fill="#3b82f6" fillOpacity={0.25} />
                <Radar name="ORG (Entity)" dataKey="ORG" stroke="#f59e0b" fill="#f59e0b" fillOpacity={0.25} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Tooltip />
              </RadarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* ── Row 3: Assessment Scores + Top Risk Indicators ── */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          <div className="bg-card border border-border rounded-xl p-5">
            <div className="text-sm font-semibold mb-4">Risk Assessment Score Distribution</div>
            {assessmentScoreBreakdown.length === 0 ? (
              <div className="flex items-center justify-center h-40 text-muted-foreground text-sm">No risk assessment records found</div>
            ) : (
              <div className="space-y-3">
                {RISK_ORDER.map(r => {
                  const item = assessmentScoreBreakdown.find(x => x.name === r);
                  const count = item?.value || 0;
                  const total = assessmentScoreBreakdown.reduce((a, b) => a + b.value, 0);
                  const pct = total > 0 ? Math.round((count / total) * 100) : 0;
                  return (
                    <div key={r}>
                      <div className="flex items-center justify-between text-xs mb-1">
                        <span className="font-medium" style={{ color: RISK_COLORS[r] }}>{r}</span>
                        <span className="text-muted-foreground tabular-nums">{count} assessments ({pct}%)</span>
                      </div>
                      <div className="h-3 rounded-full overflow-hidden bg-muted">
                        <div
                          className="h-full rounded-full transition-all duration-500"
                          style={{ width: `${pct}%`, backgroundColor: RISK_COLORS[r] }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div className="bg-card border border-border rounded-xl p-5">
            <div className="text-sm font-semibold mb-4">Top Risk Indicators (most triggered)</div>
            {topIndicators.length === 0 ? (
              <div className="flex items-center justify-center h-40 text-muted-foreground text-sm">No risk indicators recorded yet</div>
            ) : (
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={topIndicators} layout="vertical" margin={{ top: 0, right: 50, left: 0, bottom: 0 }}>
                  <XAxis type="number" tick={{ fontSize: 10 }} allowDecimals={false} />
                  <YAxis type="category" dataKey="name" tick={{ fontSize: 10 }} width={160} />
                  <Tooltip />
                  <Bar dataKey="count" fill="hsl(var(--primary))" radius={[0, 4, 4, 0]}>
                    <LabelList dataKey="count" position="right" style={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>

        {/* ── Client Drilldown Table ── */}
        <div className="bg-card border border-border rounded-xl overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-border">
            <div className="flex items-center gap-3">
              <span className="text-sm font-semibold">
                Client Risk Drilldown
              </span>
              <div className="flex gap-1">
                {['all', ...RISK_ORDER].map(r => (
                  <button
                    key={r}
                    onClick={() => setRiskFilter(r)}
                    className={cn(
                      'text-xs px-2.5 py-1 rounded-full border font-medium transition-colors',
                      riskFilter === r
                        ? 'text-white border-transparent'
                        : 'border-border text-muted-foreground hover:bg-muted/50'
                    )}
                    style={riskFilter === r ? { backgroundColor: r === 'all' ? 'hsl(var(--primary))' : RISK_COLORS[r] } : {}}
                  >
                    {r === 'all' ? 'All' : r}
                    {r !== 'all' && (
                      <span className="ml-1 opacity-75">
                        ({activeClients.filter(c => c.risk_classification === r).length})
                      </span>
                    )}
                  </button>
                ))}
              </div>
            </div>
            <span className="text-xs text-muted-foreground">{filteredClients.length} clients</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-muted/40 border-b border-border text-xs text-muted-foreground uppercase tracking-wide">
                  <th className="text-left px-4 py-2.5">Client Name</th>
                  <th className="text-left px-4 py-2.5">Type</th>
                  <th className="text-left px-4 py-2.5">Risk Class</th>
                  <th className="text-left px-4 py-2.5">Status</th>
                  <th className="text-left px-4 py-2.5">Next Review</th>
                  <th className="text-left px-4 py-2.5 w-20"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {filteredClients.slice(0, 20).map(c => (
                  <tr key={c.id} className="hover:bg-muted/20 transition-colors">
                    <td className="px-4 py-2.5 font-medium text-foreground text-sm max-w-[200px] truncate">
                      {c.full_name}
                    </td>
                    <td className="px-4 py-2.5">
                      <span className={cn(
                        'text-xs font-medium px-1.5 py-0.5 rounded',
                        c.client_type === 'ORG' ? 'bg-blue-100 text-blue-700' : 'bg-violet-100 text-violet-700'
                      )}>
                        {c.client_type || '—'}
                      </span>
                    </td>
                    <td className="px-4 py-2.5">
                      {c.risk_classification ? (
                        <span className="inline-flex items-center gap-1.5 text-xs font-semibold">
                          <span className="w-2 h-2 rounded-full" style={{ backgroundColor: RISK_COLORS[c.risk_classification] }} />
                          {c.risk_classification}
                        </span>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-xs text-muted-foreground">{c.status}</td>
                    <td className="px-4 py-2.5 text-xs text-muted-foreground">
                      {c.next_review_date ? format(new Date(c.next_review_date), 'd MMM yyyy') : '—'}
                    </td>
                    <td className="px-4 py-2.5">
                      <Button size="sm" variant="ghost" className="h-7 text-xs gap-1"
                        onClick={() => navigate(`/client/${c.id}`)}>
                        View <ChevronRight className="w-3 h-3" />
                      </Button>
                    </td>
                  </tr>
                ))}
                {filteredClients.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-4 py-8 text-center text-sm text-muted-foreground">
                      No clients in this risk category
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
            {filteredClients.length > 20 && (
              <div className="px-4 py-3 border-t border-border text-xs text-muted-foreground">
                Showing 20 of {filteredClients.length} clients
              </div>
            )}
          </div>
        </div>
      </div>
    </AppShell>
  );
}