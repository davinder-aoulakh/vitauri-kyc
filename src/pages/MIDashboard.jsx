import React, { useState, useEffect, useMemo } from 'react';
import { base44 } from '@/api/base44Client';
import { useTenant } from '@/lib/tenantContext';
import { hasPermission } from '@/lib/permissions';
import AppShell from '@/components/layout/AppShell';
import PageHeader from '@/components/shared/PageHeader';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend, LineChart, Line, CartesianGrid,
  ScatterChart, Scatter, FunnelChart, Funnel, LabelList, RadarChart, Radar, PolarGrid, PolarAngleAxis
} from 'recharts';
import {
  Loader2, Download, BarChart3, Users, Shield, Sparkles,
  ExternalLink, RefreshCw, Copy, AlertTriangle, ChevronRight
} from 'lucide-react';
import { format, subMonths, isWithinInterval, startOfMonth, endOfMonth, differenceInDays } from 'date-fns';
import { cn } from '@/lib/utils';

const RISK_COLORS  = { Low: '#22c55e', Medium: '#f59e0b', High: '#ef4444', Unacceptable: '#881337' };
const STATUS_COLORS = ['#3b82f6','#f59e0b','#22c55e','#ef4444','#8b5cf6','#6b7280','#14b8a6','#f97316'];
const CLOSED = ['Approved','Closed','Rejected'];

function exportCSV(rows, filename) {
  if (!rows.length) return;
  const headers = Object.keys(rows[0]).join(',');
  const body = rows.map(r => Object.values(r).map(v => `"${String(v).replace(/"/g,'""')}"`).join(',')).join('\n');
  const blob = new Blob([headers + '\n' + body], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

function SectionHeader({ title, onExport, exportLabel = 'CSV' }) {
  return (
    <div className="flex items-center justify-between mb-3">
      <span className="text-sm font-semibold text-foreground">{title}</span>
      {onExport && (
        <Button size="sm" variant="ghost" className="text-xs gap-1 h-7 text-muted-foreground" onClick={onExport}>
          <Download className="w-3 h-3" /> {exportLabel}
        </Button>
      )}
    </div>
  );
}

export default function MIDashboard() {
  const { currentUser } = useTenant();
  const userRole = currentUser?.app_role;
  const isManager = hasPermission(userRole, 'viewAllTenantCases');

  const [cases, setCases]           = useState([]);
  const [clients, setClients]       = useState([]);
  const [hits, setHits]             = useState([]);
  const [aiRuns, setAiRuns]         = useState([]);
  const [users, setUsers]           = useState([]);
  const [controlMeasures, setControlMeasures] = useState([]);
  const [loading, setLoading]       = useState(true);
  const [error, setError]           = useState(null);

  // Date range filter
  const [fromDate, setFromDate] = useState(format(subMonths(new Date(), 12), 'yyyy-MM-dd'));
  const [toDate, setToDate]     = useState(format(new Date(), 'yyyy-MM-dd'));
  const [analystFilter, setAnalystFilter] = useState('all');
  const [pbiCopied, setPbiCopied]   = useState(false);
  const [activeTab, setActiveTab] = useState('overview');

  // Check for control-measures tab in query params
  React.useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('tab') === 'control-measures') setActiveTab('control-measures');
  }, []);

  useEffect(() => { if (currentUser?.tenant_id) loadData(); }, [currentUser]);

  async function loadData() {
    setLoading(true);
    setError(null);
    try {
      const [casesData, clientsData, hitsData, aiData, usersData, controlData] = await Promise.all([
        base44.entities.KycCase.filter({ tenant_id: currentUser.tenant_id }, '-created_date', 1000),
        base44.entities.Client.filter({ tenant_id: currentUser.tenant_id }, '-created_date', 1000),
        base44.entities.ScreeningHit.filter({ tenant_id: currentUser.tenant_id }, '-created_date', 500),
        base44.entities.AiAgentRun.filter({ tenant_id: currentUser.tenant_id }, '-created_date', 500),
        base44.entities.User.list(),
        base44.entities.ControlMeasure.filter({ tenant_id: currentUser.tenant_id }),
      ]);
      setCases(casesData || []);
      setClients(clientsData || []);
      setHits(hitsData || []);
      setAiRuns(aiData || []);
      setUsers(usersData || []);
      setControlMeasures(controlData || []);
    } catch (err) {
      console.error('MIDashboard loadData error:', err);
      setError(err?.message || 'Failed to load MI data');
    } finally {
      setLoading(false);
    }
  }

  // Apply date range + analyst filters
  const from = new Date(fromDate);
  const to   = new Date(toDate); to.setHours(23,59,59);

  const filteredCases = useMemo(() => cases.filter(c => {
    const d = c.created_date ? new Date(c.created_date) : null;
    if (d && !isWithinInterval(d, { start: from, end: to })) return false;
    if (analystFilter !== 'all' && c.assigned_analyst_id !== analystFilter) return false;
    return true;
  }), [cases, fromDate, toDate, analystFilter]);

  const filteredHits = useMemo(() => hits.filter(h => {
    const d = h.created_date ? new Date(h.created_date) : null;
    return d && isWithinInterval(d, { start: from, end: to });
  }), [hits, fromDate, toDate]);

  const filteredAi = useMemo(() => aiRuns.filter(r => {
    const d = r.created_date ? new Date(r.created_date) : null;
    return d && isWithinInterval(d, { start: from, end: to });
  }), [aiRuns, fromDate, toDate]);

  // ── KPI computations ──────────────────────────────────────────────────────
  const activeClients   = clients.filter(c => c.status === 'Active').length;
  const openCases       = filteredCases.filter(c => !CLOSED.includes(c.status)).length;
  const approvedCases   = filteredCases.filter(c => c.status === 'Approved').length;

  // SLA compliance: cases with due_date completed on or before due
  const closedWithDue = filteredCases.filter(c => CLOSED.includes(c.status) && c.due_date && c.completed_at);
  const slaRate = closedWithDue.length
    ? Math.round(closedWithDue.filter(c => new Date(c.completed_at) <= new Date(c.due_date)).length / closedWithDue.length * 100)
    : null;

  // Avg handling time by case type and risk
  const avgHandling = useMemo(() => {
    const completed = filteredCases.filter(c => c.status === 'Approved' && c.created_date && c.completed_at);
    const grouped = {};
    completed.forEach(c => {
      const key = c.case_type?.replace(/_/g,' ') || 'Unknown';
      if (!grouped[key]) grouped[key] = [];
      grouped[key].push(differenceInDays(new Date(c.completed_at), new Date(c.created_date)));
    });
    return Object.entries(grouped).map(([type, days]) => ({
      type,
      avg: Math.round(days.reduce((a,b)=>a+b,0)/days.length),
      count: days.length,
    }));
  }, [filteredCases]);

  // Risk breakdown
  const activeClientsList = clients.filter(c => c.status === 'Active');
  const riskBreakdown = ['Low','Medium','High','Unacceptable'].map(r => ({
    name: r, value: activeClientsList.filter(c => c.risk_classification === r).length, color: RISK_COLORS[r],
  })).filter(r => r.value > 0);

  // Case status breakdown
  const statusBreakdown = Object.entries(
    filteredCases.reduce((acc, c) => { acc[c.status] = (acc[c.status]||0)+1; return acc; }, {})
  ).map(([name, value]) => ({ name: name.replace(/_/g,' '), value }));

  // Throughput: approved cases per month (last 12)
  const throughput = useMemo(() => {
    const months = Array.from({length:12}, (_,i) => {
      const d = subMonths(new Date(), 11-i);
      return { month: format(d,'MMM yy'), start: startOfMonth(d), end: endOfMonth(d), count: 0 };
    });
    filteredCases.filter(c => c.status === 'Approved' && c.completed_at).forEach(c => {
      const d = new Date(c.completed_at);
      const m = months.find(m => isWithinInterval(d, { start: m.start, end: m.end }));
      if (m) m.count++;
    });
    return months.map(m => ({ month: m.month, Approved: m.count }));
  }, [filteredCases]);

  // Case type breakdown
  const typeBreakdown = Object.entries(
    filteredCases.reduce((acc,c) => { acc[c.case_type||'Unknown']=(acc[c.case_type||'Unknown']||0)+1; return acc; }, {})
  ).map(([name,value]) => ({ name: name.replace(/_/g,' '), value }));

  // Screening this month
  const monthStart = startOfMonth(new Date());
  const hitsThisMonth  = filteredHits.filter(h => h.created_date && new Date(h.created_date) >= monthStart);
  const confirmed = hitsThisMonth.filter(h => h.status === 'Confirmed_Match').length;
  const discounted = hitsThisMonth.filter(h => h.status === 'Discounted').length;

  // AI usage
  const aiByAgent = Object.entries(
    filteredAi.reduce((acc,r) => { acc[r.agent_type]=(acc[r.agent_type]||0)+1; return acc; }, {})
  ).map(([name,value]) => ({ name, value }));

  const aiActions = {
    Accepted: filteredAi.filter(r => r.analyst_action === 'Accepted').length,
    Edited:   filteredAi.filter(r => r.analyst_action === 'Edited').length,
    Overridden: filteredAi.filter(r => r.analyst_action === 'Overridden').length,
    Rejected: filteredAi.filter(r => r.analyst_action === 'Rejected').length,
  };
  const totalActions = Object.values(aiActions).reduce((a,b)=>a+b,0);

  // Analyst breakdown
  const tenantUsers = users.filter(u => u.tenant_id === currentUser?.tenant_id);
  const analystBreakdown = tenantUsers.map(u => ({
    name: u.full_name,
    open: filteredCases.filter(c => c.assigned_analyst_id === u.id && !CLOSED.includes(c.status)).length,
    approved: filteredCases.filter(c => c.assigned_analyst_id === u.id && c.status === 'Approved').length,
    total: filteredCases.filter(c => c.assigned_analyst_id === u.id).length,
  })).filter(a => a.total > 0);

  // Avg handling time by RISK class
  const avgHandlingByRisk = useMemo(() => {
    const completed = filteredCases.filter(c => c.status === 'Approved' && c.created_date && c.completed_at && c.risk_classification);
    const grouped = {};
    completed.forEach(c => {
      const k = c.risk_classification;
      if (!grouped[k]) grouped[k] = [];
      grouped[k].push(differenceInDays(new Date(c.completed_at), new Date(c.created_date)));
    });
    return ['Low','Medium','High','Unacceptable']
      .filter(r => grouped[r]?.length)
      .map(r => ({
        risk: r,
        avg: Math.round(grouped[r].reduce((a,b)=>a+b,0)/grouped[r].length),
        count: grouped[r].length,
        fill: RISK_COLORS[r],
      }));
  }, [filteredCases]);

  // Case funnel: Draft → In Progress → … → Approved
  const FUNNEL_STAGES = ['Draft','In_Progress','Outreach_Pending','Screening','Assessment','QC','Compliance_Review','Sign_Off_Pending','Approved'];
  const caseFunnel = FUNNEL_STAGES.map(s => ({
    name: s.replace(/_/g,' '),
    value: filteredCases.filter(c => c.status === s).length,
  })).filter(s => s.value > 0);

  // Analyst throughput trend: approved cases per analyst per month (last 6m)
  const analystTrend = useMemo(() => {
    const months = Array.from({length:6}, (_,i) => {
      const d = subMonths(new Date(), 5-i);
      return { month: format(d,'MMM yy'), start: startOfMonth(d), end: endOfMonth(d) };
    });
    return months.map(m => {
      const row = { month: m.month };
      tenantUsers.slice(0, 5).forEach(u => {
        row[u.full_name] = filteredCases.filter(c =>
          c.assigned_analyst_id === u.id &&
          c.status === 'Approved' && c.completed_at &&
          isWithinInterval(new Date(c.completed_at), { start: m.start, end: m.end })
        ).length;
      });
      return row;
    });
  }, [filteredCases, tenantUsers]);

  const analystColors = ['#3b82f6','#22c55e','#f59e0b','#8b5cf6','#ef4444'];

  // Power BI export URL (stub)
  const pbiUrl = `${window.location.origin}/api/mi-export?tenant=${currentUser?.tenant_id}`;

  if (loading) return (
    <AppShell>
      <div className="flex items-center justify-center h-64"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>
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

  // Get case by ID and client name for control measures display
  const getCaseAndClient = (caseId) => {
    const kycCase = cases.find(c => c.id === caseId);
    const client = kycCase ? clients.find(c => c.id === kycCase.client_id) : null;
    return { kycCase, client };
  };

  // Filter overdue control measures
  const today = format(new Date(), 'yyyy-MM-dd');
  const overdueControlMeasures = controlMeasures
    .filter(m => m.status !== 'Completed' && m.due_date && m.due_date < today)
    .sort((a, b) => new Date(a.due_date) - new Date(b.due_date))
    .map(m => {
      const { kycCase, client } = getCaseAndClient(m.case_id);
      const daysOverdue = differenceInDays(new Date(today), new Date(m.due_date));
      return { ...m, kycCase, client, daysOverdue };
    });

  // Control Measures Tab View
  if (activeTab === 'control-measures') {
    return (
      <AppShell>
        <div className="p-6 max-w-screen-2xl mx-auto space-y-6">
          <PageHeader
            title="Control Measures Overdue"
            subtitle={`${overdueControlMeasures.length} overdue measures across active cases`}
            actions={
              <Button size="sm" variant="outline" className="gap-1.5 text-xs" onClick={() => { setActiveTab('overview'); window.history.replaceState({}, '', '/mi-dashboard'); }}>
                <ChevronRight className="w-3.5 h-3.5 rotate-180" /> Back to Overview
              </Button>
            }
          />

          <div className="bg-card border border-border rounded-xl overflow-hidden">
            {overdueControlMeasures.length === 0 ? (
              <div className="flex items-center justify-center h-40 text-muted-foreground text-sm">
                No overdue control measures
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-muted/40 border-b border-border text-xs text-muted-foreground uppercase tracking-wide">
                      <th className="text-left px-4 py-2.5">Client</th>
                      <th className="text-left px-4 py-2.5">Measure Description</th>
                      <th className="text-left px-4 py-2.5">Owner</th>
                      <th className="text-left px-4 py-2.5">Due Date</th>
                      <th className="text-left px-4 py-2.5">Days Overdue</th>
                      <th className="text-left px-4 py-2.5 w-24">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {overdueControlMeasures.map(m => (
                      <tr key={m.id} className="hover:bg-muted/30 transition-colors">
                        <td className="px-4 py-3 font-medium text-foreground text-sm max-w-[180px] truncate">
                          {m.client?.full_name || '—'}
                        </td>
                        <td className="px-4 py-3 text-sm text-foreground max-w-[300px] truncate">
                          {m.description || '—'}
                        </td>
                        <td className="px-4 py-3 text-xs text-muted-foreground">
                          {m.owner_name || '—'}
                        </td>
                        <td className="px-4 py-3 text-xs whitespace-nowrap text-muted-foreground">
                          {m.due_date ? format(new Date(m.due_date), 'd MMM yyyy') : '—'}
                        </td>
                        <td className="px-4 py-3 text-xs font-semibold text-red-600 tabular-nums">
                          {m.daysOverdue}d
                        </td>
                        <td className="px-4 py-3">
                          <Button
                            size="sm"
                            variant="ghost"
                            className="text-xs gap-1 h-7"
                            onClick={() => {
                              if (m.kycCase?.id) window.location.href = `/case/${m.kycCase.id}`;
                            }}
                          >
                            Go to case <ChevronRight className="w-3 h-3" />
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <div className="p-6 max-w-screen-2xl mx-auto space-y-6">
        <PageHeader
          title="MI Dashboard"
          subtitle="Management information — portfolio-level reporting"
          actions={
            <div className="flex items-center gap-2">
              <Input type="date" value={fromDate} onChange={e => setFromDate(e.target.value)} className="h-8 text-xs w-36" />
              <span className="text-xs text-muted-foreground">→</span>
              <Input type="date" value={toDate} onChange={e => setToDate(e.target.value)} className="h-8 text-xs w-36" />
              {isManager && (
                <Select value={analystFilter} onValueChange={setAnalystFilter}>
                  <SelectTrigger className="h-8 text-xs w-40"><SelectValue placeholder="All Analysts" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Analysts</SelectItem>
                    {tenantUsers.map(u => <SelectItem key={u.id} value={u.id}>{u.full_name}</SelectItem>)}
                  </SelectContent>
                </Select>
              )}
              <Button size="sm" variant="outline" className="gap-1.5 text-xs" onClick={loadData}>
                <RefreshCw className="w-3.5 h-3.5" /> Refresh
              </Button>
            </div>
          }
        />

        {/* ── Top KPIs ── */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
          {[
            { label: 'Active Clients', value: activeClients, sub: 'Total portfolio' },
            { label: 'Open Cases', value: openCases, sub: 'In period' },
            { label: 'Approved Cases', value: approvedCases, sub: 'In period' },
            { label: 'SLA Compliance', value: slaRate !== null ? `${slaRate}%` : '—', sub: 'On-time closures' },
            { label: 'High / Unacceptable', value: activeClientsList.filter(c=>['High','Unacceptable'].includes(c.risk_classification)).length, sub: 'Active clients' },
          ].map(k => (
            <div key={k.label} className="bg-card border border-border rounded-xl p-4">
              <div className="text-2xl font-bold tabular-nums text-foreground">{k.value}</div>
              <div className="text-xs font-medium text-foreground mt-0.5">{k.label}</div>
              <div className="text-xs text-muted-foreground">{k.sub}</div>
            </div>
          ))}
        </div>

        {/* ── Row 1: Throughput + Risk Distribution ── */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
          <div className="lg:col-span-2 bg-card border border-border rounded-xl p-4">
            <SectionHeader title="Monthly Throughput (Approved Cases — last 12m)"
              onExport={() => exportCSV(throughput, 'throughput.csv')} />
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={throughput} margin={{ top: 0, right: 10, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="month" tick={{ fontSize: 10 }} />
                <YAxis tick={{ fontSize: 10 }} allowDecimals={false} />
                <Tooltip />
                <Bar dataKey="Approved" fill="hsl(var(--primary))" radius={[4,4,0,0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>

          <div className="bg-card border border-border rounded-xl p-4">
            <SectionHeader title="Active Clients by Risk Class"
              onExport={() => exportCSV(riskBreakdown.map(r=>({risk:r.name,count:r.value})), 'risk-breakdown.csv')} />
            {riskBreakdown.length === 0
              ? <div className="flex items-center justify-center h-40 text-muted-foreground text-sm">No data</div>
              : <ResponsiveContainer width="100%" height={220}>
                  <PieChart>
                    <Pie data={riskBreakdown} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={80}
                      label={({ name, percent }) => `${name} ${(percent*100).toFixed(0)}%`} labelLine={false} fontSize={11}>
                      {riskBreakdown.map((e,i) => <Cell key={i} fill={e.color} />)}
                    </Pie>
                    <Tooltip />
                  </PieChart>
                </ResponsiveContainer>
            }
          </div>
        </div>

        {/* ── Row 2: Case Status + Case Type ── */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          <div className="bg-card border border-border rounded-xl p-4">
            <SectionHeader title="Cases by Status"
              onExport={() => exportCSV(statusBreakdown, 'cases-by-status.csv')} />
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={statusBreakdown} margin={{ top: 0, right: 10, left: -20, bottom: 40 }}>
                <XAxis dataKey="name" tick={{ fontSize: 10 }} angle={-30} textAnchor="end" />
                <YAxis tick={{ fontSize: 10 }} allowDecimals={false} />
                <Tooltip />
                <Bar dataKey="value" fill="hsl(var(--chart-2))" radius={[4,4,0,0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>

          <div className="bg-card border border-border rounded-xl p-4">
            <SectionHeader title="Average Handling Time (days) by Case Type"
              onExport={() => exportCSV(avgHandling, 'avg-handling-time.csv')} />
            {avgHandling.length === 0
              ? <div className="flex items-center justify-center h-40 text-muted-foreground text-sm">No completed cases in range</div>
              : <ResponsiveContainer width="100%" height={200}>
                  <BarChart data={avgHandling} margin={{ top: 0, right: 10, left: -20, bottom: 40 }}>
                    <XAxis dataKey="type" tick={{ fontSize: 10 }} angle={-20} textAnchor="end" />
                    <YAxis tick={{ fontSize: 10 }} allowDecimals={false} />
                    <Tooltip formatter={(v) => [`${v} days`, 'Avg']} />
                    <Bar dataKey="avg" fill="hsl(var(--chart-3))" radius={[4,4,0,0]} />
                  </BarChart>
                </ResponsiveContainer>
            }
          </div>
        </div>

        {/* ── Row 3: Screening + AI Usage ── */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">

          {/* Screening */}
          <div className="bg-card border border-border rounded-xl p-4">
            <SectionHeader title="Screening Hits" onExport={() => exportCSV([
              { period: 'This month', total: hitsThisMonth.length, confirmed, discounted },
            ], 'screening.csv')} />
            <div className="grid grid-cols-3 gap-3">
              {[
                { label: 'Total Hits (period)', value: filteredHits.length, color: 'text-foreground' },
                { label: 'Confirmed Matches', value: filteredHits.filter(h=>h.status==='Confirmed_Match').length, color: 'text-red-600' },
                { label: 'Discounted', value: filteredHits.filter(h=>h.status==='Discounted').length, color: 'text-emerald-600' },
              ].map(s => (
                <div key={s.label} className="bg-muted/30 border border-border rounded-lg p-3 text-center">
                  <div className={cn('text-2xl font-bold', s.color)}>{s.value}</div>
                  <div className="text-xs text-muted-foreground mt-1">{s.label}</div>
                </div>
              ))}
            </div>
            <div className="mt-3">
              <div className="text-xs text-muted-foreground mb-2">Hit status breakdown</div>
              <div className="space-y-1.5">
                {Object.entries(filteredHits.reduce((acc,h)=>{acc[h.status]=(acc[h.status]||0)+1;return acc;},{})).map(([status, count]) => (
                  <div key={status} className="flex items-center gap-2">
                    <div className="text-xs text-muted-foreground w-32 truncate">{status.replace(/_/g,' ')}</div>
                    <div className="flex-1 bg-muted rounded-full h-1.5">
                      <div className="bg-primary h-1.5 rounded-full" style={{ width: `${filteredHits.length ? (count/filteredHits.length*100).toFixed(0) : 0}%` }} />
                    </div>
                    <span className="text-xs font-mono text-muted-foreground w-6 text-right">{count}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* AI Usage */}
          <div className="bg-card border border-border rounded-xl p-4">
            <SectionHeader title="AI Usage" onExport={() => exportCSV(
              Object.entries(aiActions).map(([action,count])=>({action,count})), 'ai-usage.csv'
            )} />
            <div className="grid grid-cols-2 gap-3 mb-4">
              {[
                { label: 'Total Invocations', value: filteredAi.length },
                { label: 'Tokens Used', value: filteredAi.reduce((s,r)=>(s+(r.tokens_input||0)+(r.tokens_output||0)),0).toLocaleString() },
              ].map(k => (
                <div key={k.label} className="bg-purple-50 border border-purple-100 rounded-lg p-3 text-center">
                  <div className="text-xl font-bold text-purple-700">{k.value}</div>
                  <div className="text-xs text-purple-600 mt-0.5">{k.label}</div>
                </div>
              ))}
            </div>
            {/* By agent type */}
            {aiByAgent.length > 0 && (
              <div className="mb-3">
                <div className="text-xs text-muted-foreground mb-2">Invocations by agent</div>
                <ResponsiveContainer width="100%" height={120}>
                  <BarChart data={aiByAgent} margin={{ top: 0, right: 0, left: -30, bottom: 30 }}>
                    <XAxis dataKey="name" tick={{ fontSize: 9 }} angle={-30} textAnchor="end" />
                    <YAxis tick={{ fontSize: 9 }} allowDecimals={false} />
                    <Tooltip />
                    <Bar dataKey="value" fill="#7c3aed" radius={[2,2,0,0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
            {/* Analyst action rates */}
            {totalActions > 0 && (
              <div className="space-y-1.5">
                <div className="text-xs text-muted-foreground mb-2">Analyst action rates</div>
                {Object.entries(aiActions).map(([action, count]) => (
                  <div key={action} className="flex items-center gap-2">
                    <div className="text-xs w-20">{action}</div>
                    <div className="flex-1 bg-muted rounded-full h-1.5">
                      <div className="bg-purple-400 h-1.5 rounded-full" style={{ width: `${(count/totalActions*100).toFixed(0)}%` }} />
                    </div>
                    <span className="text-xs font-mono text-muted-foreground w-12 text-right">
                      {count} ({totalActions ? (count/totalActions*100).toFixed(0) : 0}%)
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* ── Row 4: Avg Handling by Risk + Case Funnel ── */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          <div className="bg-card border border-border rounded-xl p-4">
            <SectionHeader title="Avg Handling Time (days) by Risk Class"
              onExport={() => exportCSV(avgHandlingByRisk.map(r=>({risk:r.risk,avg_days:r.avg,count:r.count})), 'handling-by-risk.csv')} />
            {avgHandlingByRisk.length === 0
              ? <div className="flex items-center justify-center h-40 text-muted-foreground text-sm">No completed cases in range</div>
              : <ResponsiveContainer width="100%" height={200}>
                  <BarChart data={avgHandlingByRisk} margin={{ top: 0, right: 10, left: -20, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis dataKey="risk" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 10 }} allowDecimals={false} />
                    <Tooltip formatter={(v,n,p) => [`${v} days (${p.payload.count} cases)`, 'Avg']} />
                    <Bar dataKey="avg" radius={[4,4,0,0]}>
                      {avgHandlingByRisk.map((e,i) => <Cell key={i} fill={e.fill} />)}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
            }
          </div>

          <div className="bg-card border border-border rounded-xl p-4">
            <SectionHeader title="Live Case Pipeline (by stage)"
              onExport={() => exportCSV(caseFunnel, 'case-funnel.csv')} />
            {caseFunnel.length === 0
              ? <div className="flex items-center justify-center h-40 text-muted-foreground text-sm">No open cases in range</div>
              : <ResponsiveContainer width="100%" height={200}>
                  <BarChart data={caseFunnel} layout="vertical" margin={{ top: 0, right: 40, left: 10, bottom: 0 }}>
                    <XAxis type="number" tick={{ fontSize: 10 }} allowDecimals={false} />
                    <YAxis type="category" dataKey="name" tick={{ fontSize: 10 }} width={110} />
                    <Tooltip />
                    <Bar dataKey="value" fill="hsl(var(--primary))" radius={[0,4,4,0]}>
                      <LabelList dataKey="value" position="right" style={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} />
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
            }
          </div>
        </div>

        {/* ── Row 5: Analyst throughput trend (Manager only) ── */}
        {isManager && tenantUsers.length > 0 && (
          <div className="bg-card border border-border rounded-xl p-4">
            <SectionHeader title="Analyst Throughput Trend — Approved Cases (last 6 months)"
              onExport={() => exportCSV(analystTrend, 'analyst-trend.csv')} />
            <ResponsiveContainer width="100%" height={220}>
              <LineChart data={analystTrend} margin={{ top: 5, right: 20, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="month" tick={{ fontSize: 10 }} />
                <YAxis tick={{ fontSize: 10 }} allowDecimals={false} />
                <Tooltip />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                {tenantUsers.slice(0,5).map((u,i) => (
                  <Line key={u.id} type="monotone" dataKey={u.full_name} stroke={analystColors[i]} strokeWidth={2} dot={{ r: 3 }} />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}

        {/* ── Analyst Breakdown (Manager only) ── */}
        {isManager && analystBreakdown.length > 0 && (
          <div className="bg-card border border-border rounded-xl p-4">
            <SectionHeader title="Analyst Workload Breakdown"
              onExport={() => exportCSV(analystBreakdown, 'analyst-breakdown.csv')} />
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-muted/40 border-b border-border text-xs text-muted-foreground uppercase tracking-wide">
                    <th className="text-left px-4 py-2.5">Analyst</th>
                    <th className="text-left px-4 py-2.5">Open Cases</th>
                    <th className="text-left px-4 py-2.5">Approved (period)</th>
                    <th className="text-left px-4 py-2.5">Workload bar</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {analystBreakdown.map(a => {
                    const maxOpen = Math.max(...analystBreakdown.map(x=>x.open), 1);
                    return (
                      <tr key={a.name} className="hover:bg-muted/20">
                        <td className="px-4 py-2.5 text-xs font-medium">{a.name}</td>
                        <td className="px-4 py-2.5 text-xs tabular-nums font-semibold">{a.open}</td>
                        <td className="px-4 py-2.5 text-xs tabular-nums text-emerald-600 font-semibold">{a.approved}</td>
                        <td className="px-4 py-2.5">
                          <div className="flex items-center gap-2">
                            <div className="flex-1 bg-muted rounded-full h-2">
                              <div className="bg-primary h-2 rounded-full transition-all" style={{ width: `${(a.open/maxOpen*100).toFixed(0)}%` }} />
                            </div>
                            <span className="text-xs text-muted-foreground w-6 tabular-nums">{a.open}</span>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ── Power BI stub ── */}
        <div className="bg-card border border-border rounded-xl p-5">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-lg bg-amber-100 flex items-center justify-center flex-shrink-0">
              <BarChart3 className="w-5 h-5 text-amber-600" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="font-semibold text-sm">Power BI Integration <span className="ml-2 text-xs bg-muted text-muted-foreground px-2 py-0.5 rounded-full">Post-MVP</span></div>
              <p className="text-xs text-muted-foreground mt-1">
                Connect your Power BI workspace to stream live KYC portfolio data into custom dashboards.
                Use the JSON export endpoint below as your Power BI dataset source.
              </p>
              <div className="mt-3 flex items-center gap-2 bg-muted/50 border border-border rounded-lg px-3 py-2">
                <code className="text-xs font-mono text-foreground flex-1 truncate">{pbiUrl}</code>
                <button onClick={() => { navigator.clipboard.writeText(pbiUrl); setPbiCopied(true); setTimeout(()=>setPbiCopied(false),2000); }}
                  className="text-muted-foreground hover:text-foreground transition-colors flex-shrink-0">
                  {pbiCopied ? <span className="text-xs text-emerald-600">Copied!</span> : <Copy className="w-3.5 h-3.5" />}
                </button>
              </div>
              <div className="mt-2 text-xs text-muted-foreground">
                In Power BI: Get Data → Web → paste the endpoint URL. The response is a JSON object with keys: <code className="font-mono">cases</code>, <code className="font-mono">clients</code>, <code className="font-mono">screening_hits</code>, <code className="font-mono">ai_runs</code>.
              </div>
            </div>
          </div>
        </div>
      </div>
    </AppShell>
  );
}