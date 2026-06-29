import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import OpsDiditPanel from '@/components/ops/OpsDiditPanel';
import NewTenantDialog from '@/components/ops/NewTenantDialog';
import { base44 } from '@/api/base44Client';
import { useTenant } from '@/lib/tenantContext';
import {
  Shield, Building2, AlertTriangle, FolderOpen, Activity,
  ExternalLink, Users, Cpu, Database, TrendingUp, Ban,
  RefreshCw, Search, ChevronDown, Loader2
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { format } from 'date-fns';
import { cn } from '@/lib/utils';

const statusColor = {
  Active: 'bg-emerald-100 text-emerald-700',
  Suspended: 'bg-red-100 text-red-700',
  Demo: 'bg-blue-100 text-blue-700',
};

export default function OpsDashboard() {
  const { currentUser, setOpsTenantId, refreshOpsTenant } = useTenant();
  const navigate = useNavigate();

  const [tenants, setTenants]   = useState([]);
  const [cases, setCases]       = useState([]);
  const [alerts, setAlerts]     = useState([]);
  const [users, setUsers]       = useState([]);
  const [aiRuns, setAiRuns]     = useState([]);
  const [loading, setLoading]   = useState(true);
  const [search, setSearch]     = useState('');
  const [activeTab, setActiveTab] = useState('tenants'); // 'tenants' | 'users' | 'health'
  const [deactivating, setDeactivating] = useState(null);
  const [expandedTenant, setExpandedTenant] = useState(null);
  const [diditTenant, setDiditTenant] = useState(null);
  const [newTenantOpen, setNewTenantOpen] = useState(false);

  useEffect(() => {
    if (currentUser && currentUser.app_role !== 'Vitauri Ops') { navigate('/'); return; }
    if (currentUser) loadData();
  }, [currentUser]);

  async function loadData() {
    setLoading(true);
    const [tenantData, caseData, alertData, userData, aiData] = await Promise.all([
      base44.entities.Tenant.list(),
      base44.entities.KycCase.list('-created_date', 2000),
      base44.entities.MonitoringAlert.filter({ status: 'New' }),
      base44.entities.User.list(),
      base44.entities.AiAgentRun.list('-created_date', 1000),
    ]);
    setTenants(tenantData || []);
    setCases(caseData || []);
    setAlerts(alertData || []);
    setUsers(userData || []);
    setAiRuns(aiData || []);
    setLoading(false);
  }

  const today = new Date().toISOString().split('T')[0];

  function tenantStats(tenantId) {
    const tc = cases.filter(c => c.tenant_id === tenantId);
    const active  = tc.filter(c => !['Approved','Closed','Rejected'].includes(c.status));
    const overdue = active.filter(c => c.due_date && c.due_date < today);
    const userCount = users.filter(u => u.tenant_id === tenantId).length;
    const alertCount = alerts.filter(a => a.tenant_id === tenantId).length;
    return { active: active.length, overdue: overdue.length, userCount, alertCount };
  }

  async function deactivateUser(user) {
    setDeactivating(user.id);
    await base44.entities.User.update(user.id, { status: 'Inactive' });
    setUsers(prev => prev.map(u => u.id === user.id ? { ...u, status: 'Inactive' } : u));
    setDeactivating(null);
  }

  async function reactivateUser(user) {
    setDeactivating(user.id);
    await base44.entities.User.update(user.id, { status: 'Active' });
    setUsers(prev => prev.map(u => u.id === user.id ? { ...u, status: 'Active' } : u));
    setDeactivating(null);
  }

  const totalActive  = cases.filter(c => !['Approved','Closed','Rejected'].includes(c.status)).length;
  const totalOverdue = cases.filter(c => !['Approved','Closed','Rejected'].includes(c.status) && c.due_date && c.due_date < today).length;
  const totalUsers   = users.length;

  // System health: AI token usage per tenant
  const aiTokensByTenant = tenants.map(t => {
    const runs = aiRuns.filter(r => r.tenant_id === t.id);
    const tokens = runs.reduce((s,r) => s + (r.tokens_input||0) + (r.tokens_output||0), 0);
    return { name: t.name, runs: runs.length, tokens };
  }).sort((a,b) => b.tokens - a.tokens);

  const totalTokens = aiRuns.reduce((s,r) => s + (r.tokens_input||0) + (r.tokens_output||0), 0);
  const totalRuns   = aiRuns.length;

  const filteredTenants = tenants.filter(t =>
    !search || t.name?.toLowerCase().includes(search.toLowerCase()) || t.slug?.toLowerCase().includes(search.toLowerCase())
  );

  const filteredUsers = users.filter(u =>
    !search || u.full_name?.toLowerCase().includes(search.toLowerCase()) || u.email?.toLowerCase().includes(search.toLowerCase())
  );

  function handleViewTenant(tenant) {
    if (setOpsTenantId) setOpsTenantId(tenant.id);
    navigate('/');
  }

  return (
    <div className="min-h-screen bg-background font-inter">
      {/* Top bar */}
      <header className="h-14 bg-navy border-b border-navy-border flex items-center justify-between px-6">
        <div className="flex items-center gap-3">
          <div className="w-7 h-7 rounded-md bg-primary flex items-center justify-center">
            <Shield className="w-4 h-4 text-white" />
          </div>
          <span className="text-white font-semibold text-sm">Vitauri KYC</span>
          <span className="text-white/40 text-sm">|</span>
          <span className="text-white/60 text-xs font-medium uppercase tracking-widest">Ops Super-Admin</span>
        </div>
        <div className="flex items-center gap-3">
          <button onClick={loadData} className="text-white/60 hover:text-white transition-colors">
            <RefreshCw className="w-4 h-4" />
          </button>
          <span className="text-white/70 text-sm">{currentUser?.full_name}</span>
        </div>
      </header>

      <div className="p-6 max-w-screen-2xl mx-auto">
        <div className="mb-5">
          <h1 className="text-xl font-semibold">Cross-Tenant Operations</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Platform-wide oversight — read-only access per tenant</p>
        </div>

        {/* Summary KPIs */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-6">
          {[
            { label: 'Total Tenants',    value: tenants.length,  icon: Building2, color: '' },
            { label: 'Total Users',      value: totalUsers,      icon: Users,     color: '' },
            { label: 'Active Cases',     value: totalActive,     icon: FolderOpen, color: '' },
            { label: 'Overdue Cases',    value: totalOverdue,    icon: AlertTriangle, color: totalOverdue > 0 ? 'text-red-600' : '' },
            { label: 'Open Alerts',      value: alerts.length,   icon: Activity,  color: alerts.length > 0 ? 'text-amber-600' : '' },
          ].map(s => (
            <div key={s.label} className="bg-card border border-border rounded-xl p-4">
              <div className={cn('text-3xl font-bold tabular-nums', s.color)}>{loading ? '…' : s.value}</div>
              <div className="text-xs text-muted-foreground mt-1 flex items-center gap-1">
                <s.icon className="w-3 h-3" />
                {s.label}
              </div>
            </div>
          ))}
        </div>

        {/* Tabs */}
        <div className="flex gap-1 bg-muted/40 rounded-xl p-1 border border-border mb-5 w-fit">
          {[
            ['tenants', 'Tenant Overview'],
            ['users', 'User Management'],
            ['health', 'System Health'],
          ].map(([v, l]) => (
            <button key={v} onClick={() => setActiveTab(v)}
              className={cn('text-xs font-medium px-4 py-2 rounded-lg transition-colors',
                activeTab === v ? 'bg-card shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground')}>
              {l}
            </button>
          ))}
        </div>

        {/* Search */}
        {(activeTab === 'tenants' || activeTab === 'users') && (
          <div className="relative mb-4 max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
            <Input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder={activeTab === 'tenants' ? 'Search tenants…' : 'Search users…'}
              className="pl-9 h-8 text-sm"
            />
          </div>
        )}

        {/* ── Tenant Overview ── */}
        {activeTab === 'tenants' && (
          <div className="bg-card border border-border rounded-xl overflow-hidden">
            <div className="px-4 py-3 border-b border-border flex items-center justify-between">
              <h2 className="font-semibold text-sm">Tenant Overview</h2>
              <div className="flex items-center gap-3">
                <span className="text-xs text-muted-foreground">{filteredTenants.length} tenants</span>
                <Button size="sm" className="h-7 text-xs gap-1" onClick={() => setNewTenantOpen(true)}>
                  <Building2 className="w-3.5 h-3.5" /> Add Tenant
                </Button>
              </div>
            </div>
            {loading ? (
              <div className="p-8 flex items-center justify-center"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-muted/40 border-b border-border text-xs text-muted-foreground uppercase tracking-wide">
                      <th className="text-left px-4 py-3">Tenant</th>
                      <th className="text-left px-4 py-3">Status</th>
                      <th className="text-left px-4 py-3">Users</th>
                      <th className="text-left px-4 py-3">Active Cases</th>
                      <th className="text-left px-4 py-3">Overdue</th>
                      <th className="text-left px-4 py-3">Alerts</th>
                      <th className="text-left px-4 py-3">Updated</th>
                      <th className="px-4 py-3" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {filteredTenants.length === 0 ? (
                      <tr><td colSpan={8} className="px-4 py-12 text-center text-muted-foreground text-sm">No tenants found</td></tr>
                    ) : filteredTenants.map(t => {
                      const s = tenantStats(t.id);
                      const isExpanded = expandedTenant === t.id;
                      const tenantUsers = users.filter(u => u.tenant_id === t.id);
                      return (
                        <React.Fragment key={t.id}>
                          <tr className="hover:bg-muted/30 transition-colors">
                            <td className="px-4 py-3">
                              <div className="flex items-center gap-2">
                                <div className="w-7 h-7 rounded-lg flex items-center justify-center text-white text-xs font-bold flex-shrink-0"
                                  style={{ backgroundColor: t.branding_primary_color || '#1A6BFF' }}>
                                  {t.name?.charAt(0)}
                                </div>
                                <div>
                                  <div className="font-medium text-sm">{t.name}</div>
                                  <div className="text-xs text-muted-foreground">{t.slug}</div>
                                </div>
                              </div>
                            </td>
                            <td className="px-4 py-3">
                              <span className={cn('text-xs px-2 py-0.5 rounded-full font-medium', statusColor[t.status] || 'bg-slate-100 text-slate-600')}>
                                {t.status || 'Active'}
                              </span>
                            </td>
                            <td className="px-4 py-3 text-sm tabular-nums">{s.userCount}</td>
                            <td className="px-4 py-3 text-sm tabular-nums font-medium">{s.active}</td>
                            <td className="px-4 py-3">
                              <span className={cn('text-sm tabular-nums font-medium', s.overdue > 0 ? 'text-red-600' : 'text-foreground')}>{s.overdue}</span>
                            </td>
                            <td className="px-4 py-3">
                              <span className={cn('text-sm tabular-nums font-medium', s.alertCount > 0 ? 'text-amber-600' : 'text-foreground')}>{s.alertCount}</span>
                            </td>
                            <td className="px-4 py-3 text-xs text-muted-foreground">
                              {t.updated_date ? format(new Date(t.updated_date), 'd MMM yyyy') : '—'}
                            </td>
                            <td className="px-4 py-3 text-right">
                              <div className="flex items-center gap-2 justify-end">
                                <button
                                  onClick={() => setExpandedTenant(isExpanded ? null : t.id)}
                                  className="text-xs text-muted-foreground hover:text-foreground transition-colors flex items-center gap-0.5"
                                >
                                  <ChevronDown className={cn('w-3.5 h-3.5 transition-transform', isExpanded && 'rotate-180')} />
                                  Users
                                </button>
                                <Button variant="outline" size="sm" className="text-xs gap-1 h-7" onClick={() => setDiditTenant(t)}>
                                  🪪 Didit
                                </Button>
                                <Button variant="outline" size="sm" className="text-xs gap-1 h-7" onClick={() => handleViewTenant(t)}>
                                  View <ExternalLink className="w-3 h-3" />
                                </Button>
                              </div>
                            </td>
                          </tr>
                          {/* Expanded user sub-table */}
                          {isExpanded && (
                            <tr>
                              <td colSpan={8} className="px-8 py-3 bg-muted/20 border-b border-border">
                                <div className="text-xs font-semibold text-muted-foreground mb-2">Users in {t.name}</div>
                                {tenantUsers.length === 0 ? (
                                  <div className="text-xs text-muted-foreground">No users</div>
                                ) : (
                                  <div className="flex flex-wrap gap-2">
                                    {tenantUsers.map(u => (
                                      <div key={u.id} className="flex items-center gap-2 bg-card border border-border rounded-lg px-2.5 py-1.5">
                                        <div className="w-5 h-5 rounded-full bg-primary/20 flex items-center justify-center text-primary text-xs font-semibold">
                                          {u.full_name?.charAt(0)}
                                        </div>
                                        <div>
                                          <div className="text-xs font-medium">{u.full_name}</div>
                                          <div className="text-[10px] text-muted-foreground">{u.app_role}</div>
                                        </div>
                                        <span className={cn('text-[10px] px-1.5 py-0.5 rounded-full font-medium ml-1',
                                          u.status === 'Inactive' ? 'bg-red-100 text-red-700' : 'bg-emerald-100 text-emerald-700')}>
                                          {u.status || 'Active'}
                                        </span>
                                      </div>
                                    ))}
                                  </div>
                                )}
                              </td>
                            </tr>
                          )}
                        </React.Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* ── User Management ── */}
        {activeTab === 'users' && (
          <div className="bg-card border border-border rounded-xl overflow-hidden">
            <div className="px-4 py-3 border-b border-border flex items-center justify-between">
              <h2 className="font-semibold text-sm">All Users — Cross-Tenant</h2>
              <span className="text-xs text-muted-foreground">{filteredUsers.length} users</span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-muted/40 border-b border-border text-xs text-muted-foreground uppercase tracking-wide">
                    <th className="text-left px-4 py-3">User</th>
                    <th className="text-left px-4 py-3">Tenant</th>
                    <th className="text-left px-4 py-3">Role</th>
                    <th className="text-left px-4 py-3">Status</th>
                    <th className="text-left px-4 py-3">Last Active</th>
                    <th className="px-4 py-3" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {filteredUsers.length === 0 ? (
                    <tr><td colSpan={6} className="px-4 py-12 text-center text-muted-foreground text-sm">No users found</td></tr>
                  ) : filteredUsers.map(u => {
                    const userTenant = tenants.find(t => t.id === u.tenant_id);
                    const isActive = u.status !== 'Inactive';
                    return (
                      <tr key={u.id} className="hover:bg-muted/20 transition-colors">
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            <div className="w-7 h-7 rounded-full bg-primary/15 flex items-center justify-center text-primary text-xs font-semibold flex-shrink-0">
                              {u.full_name?.charAt(0)}
                            </div>
                            <div>
                              <div className="text-xs font-medium">{u.full_name}</div>
                              <div className="text-xs text-muted-foreground">{u.email}</div>
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-3 text-xs">
                          {userTenant ? (
                            <div className="flex items-center gap-1.5">
                              <div className="w-4 h-4 rounded flex-shrink-0 flex items-center justify-center text-white text-[9px] font-bold"
                                style={{ backgroundColor: userTenant.branding_primary_color || '#1A6BFF' }}>
                                {userTenant.name?.charAt(0)}
                              </div>
                              <span>{userTenant.name}</span>
                            </div>
                          ) : <span className="text-muted-foreground">—</span>}
                        </td>
                        <td className="px-4 py-3 text-xs">{u.app_role || u.role || '—'}</td>
                        <td className="px-4 py-3">
                          <span className={cn('text-xs px-2 py-0.5 rounded-full font-medium',
                            isActive ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700')}>
                            {u.status || 'Active'}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-xs text-muted-foreground">
                          {u.updated_date ? format(new Date(u.updated_date), 'd MMM yyyy') : '—'}
                        </td>
                        <td className="px-4 py-3 text-right">
                          {deactivating === u.id ? (
                            <Loader2 className="w-4 h-4 animate-spin text-muted-foreground ml-auto" />
                          ) : isActive ? (
                            <Button variant="outline" size="sm" className="text-xs gap-1 h-7 text-red-600 border-red-200 hover:bg-red-50"
                              onClick={() => deactivateUser(u)}>
                              <Ban className="w-3 h-3" /> Deactivate
                            </Button>
                          ) : (
                            <Button variant="outline" size="sm" className="text-xs gap-1 h-7 text-emerald-600 border-emerald-200 hover:bg-emerald-50"
                              onClick={() => reactivateUser(u)}>
                              Reactivate
                            </Button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ── System Health ── */}
        {activeTab === 'health' && (
          <div className="space-y-5">
            {/* AI Usage summary */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {[
                { label: 'Total AI Invocations', value: totalRuns, icon: Cpu, color: 'text-purple-600', bg: 'bg-purple-50 border-purple-100' },
                { label: 'Total AI Tokens Used', value: totalTokens.toLocaleString(), icon: TrendingUp, color: 'text-blue-600', bg: 'bg-blue-50 border-blue-100' },
                { label: 'Active Tenants', value: tenants.filter(t => t.status !== 'Suspended').length, icon: Building2, color: 'text-emerald-600', bg: 'bg-emerald-50 border-emerald-100' },
              ].map(k => (
                <div key={k.label} className={cn('rounded-xl border p-4', k.bg)}>
                  <div className={cn('text-3xl font-bold tabular-nums', k.color)}>{loading ? '…' : k.value}</div>
                  <div className={cn('text-xs mt-1 flex items-center gap-1', k.color)}>
                    <k.icon className="w-3.5 h-3.5" /> {k.label}
                  </div>
                </div>
              ))}
            </div>

            {/* AI tokens per tenant */}
            <div className="bg-card border border-border rounded-xl overflow-hidden">
              <div className="px-4 py-3 border-b border-border">
                <h2 className="font-semibold text-sm">AI Token Usage by Tenant</h2>
              </div>
              <div className="p-4 space-y-3">
                {aiTokensByTenant.length === 0 ? (
                  <div className="text-sm text-muted-foreground py-6 text-center">No AI usage data yet</div>
                ) : aiTokensByTenant.map(t => {
                  const maxTokens = Math.max(...aiTokensByTenant.map(x => x.tokens), 1);
                  return (
                    <div key={t.name} className="flex items-center gap-3">
                      <div className="text-xs font-medium w-40 truncate">{t.name}</div>
                      <div className="flex-1 bg-muted rounded-full h-2">
                        <div className="bg-purple-400 h-2 rounded-full" style={{ width: `${(t.tokens / maxTokens * 100).toFixed(0)}%` }} />
                      </div>
                      <div className="text-xs text-muted-foreground w-24 text-right tabular-nums">
                        {t.tokens.toLocaleString()} tokens
                      </div>
                      <div className="text-xs text-muted-foreground w-16 text-right tabular-nums">
                        {t.runs} runs
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Tenant health status table */}
            <div className="bg-card border border-border rounded-xl overflow-hidden">
              <div className="px-4 py-3 border-b border-border">
                <h2 className="font-semibold text-sm">Tenant Health Indicators</h2>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-muted/40 border-b border-border text-xs text-muted-foreground uppercase tracking-wide">
                      <th className="text-left px-4 py-2.5">Tenant</th>
                      <th className="text-left px-4 py-2.5">Status</th>
                      <th className="text-left px-4 py-2.5">Total Cases</th>
                      <th className="text-left px-4 py-2.5">Open Cases</th>
                      <th className="text-left px-4 py-2.5">Overdue</th>
                      <th className="text-left px-4 py-2.5">Open Alerts</th>
                      <th className="text-left px-4 py-2.5">AI Runs</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {tenants.map(t => {
                      const s = tenantStats(t.id);
                      const tc = cases.filter(c => c.tenant_id === t.id);
                      const ai = aiRuns.filter(r => r.tenant_id === t.id);
                      const healthScore = s.overdue > 5 || s.alertCount > 10 ? 'critical' : s.overdue > 0 || s.alertCount > 0 ? 'warning' : 'healthy';
                      return (
                        <tr key={t.id} className="hover:bg-muted/20">
                          <td className="px-4 py-2.5 text-xs font-medium">{t.name}</td>
                          <td className="px-4 py-2.5">
                            <div className="flex items-center gap-1.5">
                              <div className={cn('w-2 h-2 rounded-full',
                                healthScore === 'critical' ? 'bg-red-500' :
                                healthScore === 'warning'  ? 'bg-amber-500' : 'bg-emerald-500')} />
                              <span className="text-xs capitalize">{healthScore}</span>
                            </div>
                          </td>
                          <td className="px-4 py-2.5 text-xs tabular-nums">{tc.length}</td>
                          <td className="px-4 py-2.5 text-xs tabular-nums font-semibold">{s.active}</td>
                          <td className="px-4 py-2.5">
                            <span className={cn('text-xs tabular-nums font-semibold', s.overdue > 0 ? 'text-red-600' : 'text-muted-foreground')}>
                              {s.overdue}
                            </span>
                          </td>
                          <td className="px-4 py-2.5">
                            <span className={cn('text-xs tabular-nums font-semibold', s.alertCount > 0 ? 'text-amber-600' : 'text-muted-foreground')}>
                              {s.alertCount}
                            </span>
                          </td>
                          <td className="px-4 py-2.5 text-xs tabular-nums text-purple-600">{ai.length}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Storage / API note */}
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
              <div className="flex items-start gap-3">
                <Database className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
                <div>
                  <div className="text-sm font-semibold text-amber-800">Storage & API Error Rate</div>
                  <div className="text-xs text-amber-700 mt-1">
                    Storage usage and real-time API error rates are available via the Base44 platform operations dashboard.
                    These metrics require infrastructure-level access and are not surfaced in the application layer.
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      <NewTenantDialog
        open={newTenantOpen}
        onClose={() => setNewTenantOpen(false)}
        onCreated={() => { setNewTenantOpen(false); loadData(); }}
      />

      {diditTenant && (
        <OpsDiditPanel
          tenant={diditTenant}
          onClose={() => setDiditTenant(null)}
          onSaved={() => { setDiditTenant(null); loadData(); refreshOpsTenant?.(); }}
        />
      )}
    </div>
  );
}