import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import { useTenant } from '@/lib/tenantContext';
import { Shield, Building2, AlertTriangle, FolderOpen, Activity, ExternalLink } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { format } from 'date-fns';
import { cn } from '@/lib/utils';

const statusColor = {
  Active: 'bg-emerald-100 text-emerald-700',
  Suspended: 'bg-red-100 text-red-700',
  Demo: 'bg-blue-100 text-blue-700',
};

export default function OpsDashboard() {
  const { currentUser, setOpsTenantId } = useTenant();
  const navigate = useNavigate();
  const [tenants, setTenants] = useState([]);
  const [cases, setCases] = useState([]);
  const [alerts, setAlerts] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (currentUser && currentUser.app_role !== 'Vitauri Ops') {
      navigate('/');
      return;
    }
    if (currentUser) loadData();
  }, [currentUser]);

  async function loadData() {
    const [tenantData, caseData, alertData] = await Promise.all([
      base44.entities.Tenant.list(),
      base44.entities.KycCase.list(),
      base44.entities.MonitoringAlert.filter({ status: 'New' }),
    ]);
    setTenants(tenantData || []);
    setCases(caseData || []);
    setAlerts(alertData || []);
    setLoading(false);
  }

  const today = new Date().toISOString().split('T')[0];

  function getCasesForTenant(tenantId) {
    const tenantCases = cases.filter(c => c.tenant_id === tenantId);
    const active = tenantCases.filter(c => !['Approved', 'Closed', 'Rejected'].includes(c.status));
    const overdue = active.filter(c => c.due_date && c.due_date < today);
    return { active: active.length, overdue: overdue.length };
  }

  function getAlertsForTenant(tenantId) {
    return alerts.filter(a => a.tenant_id === tenantId).length;
  }

  const totalActive  = cases.filter(c => !['Approved', 'Closed', 'Rejected'].includes(c.status)).length;
  const totalOverdue = cases.filter(c => !['Approved', 'Closed', 'Rejected'].includes(c.status) && c.due_date && c.due_date < today).length;

  function handleViewTenant(tenant) {
    // Store the ops context then navigate to the tenant dashboard
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
          <span className="text-white/60 text-xs font-medium uppercase tracking-widest">Ops View</span>
        </div>
        <div className="flex items-center gap-2 text-white/70 text-sm">
          {currentUser?.full_name}
        </div>
      </header>

      <div className="p-6 max-w-screen-xl mx-auto">
        <div className="mb-6">
          <h1 className="text-xl font-semibold text-foreground">Cross-Tenant Operations</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Platform-wide oversight — read-only</p>
        </div>

        {/* Summary Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          {[
            { label: 'Total Tenants',       value: tenants.length,                                               icon: Building2 },
            { label: 'Active Cases (all)',   value: totalActive,                                                  icon: FolderOpen },
            { label: 'Overdue Cases (all)',  value: totalOverdue,                                                 icon: AlertTriangle },
            { label: 'Open Alerts (all)',    value: alerts.length,                                                icon: Activity },
          ].map(s => (
            <div key={s.label} className="bg-card border border-border rounded-xl p-4">
              <div className="text-xs text-muted-foreground">{s.label}</div>
              <div className="text-3xl font-bold mt-1">{loading ? '…' : s.value}</div>
            </div>
          ))}
        </div>

        {/* Tenant Table */}
        <div className="bg-card border border-border rounded-xl overflow-hidden">
          <div className="px-4 py-3 border-b border-border">
            <h2 className="font-semibold text-sm">Tenant Overview</h2>
          </div>
          {loading ? (
            <div className="p-8 text-center text-muted-foreground text-sm">Loading tenants…</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-muted/40 border-b border-border text-xs text-muted-foreground uppercase tracking-wide">
                    <th className="text-left px-4 py-3">Tenant Name</th>
                    <th className="text-left px-4 py-3">Status</th>
                    <th className="text-left px-4 py-3">Active Cases</th>
                    <th className="text-left px-4 py-3">Overdue Cases</th>
                    <th className="text-left px-4 py-3">Open Alerts</th>
                    <th className="text-left px-4 py-3">Last Activity</th>
                    <th className="px-4 py-3">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {tenants.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="px-4 py-12 text-center text-muted-foreground text-sm">
                        No tenants found
                      </td>
                    </tr>
                  ) : (
                    tenants.map(t => {
                      const { active, overdue } = getCasesForTenant(t.id);
                      const openAlerts = getAlertsForTenant(t.id);
                      return (
                        <tr key={t.id} className="hover:bg-muted/30 transition-colors">
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-2">
                              <div
                                className="w-6 h-6 rounded flex items-center justify-center text-white text-xs font-bold flex-shrink-0"
                                style={{ backgroundColor: t.branding_primary_color || '#1A6BFF' }}
                              >
                                {t.name?.charAt(0)}
                              </div>
                              <div>
                                <div className="font-medium text-foreground">{t.name}</div>
                                <div className="text-xs text-muted-foreground">{t.slug}</div>
                              </div>
                            </div>
                          </td>
                          <td className="px-4 py-3">
                            <span className={cn('inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium', statusColor[t.status] || 'bg-slate-100 text-slate-600')}>
                              {t.status || 'Active'}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-sm font-medium">{active}</td>
                          <td className="px-4 py-3">
                            <span className={cn('text-sm font-medium', overdue > 0 ? 'text-red-600' : 'text-foreground')}>{overdue}</span>
                          </td>
                          <td className="px-4 py-3">
                            <span className={cn('text-sm font-medium', openAlerts > 0 ? 'text-amber-600' : 'text-foreground')}>{openAlerts}</span>
                          </td>
                          <td className="px-4 py-3 text-xs text-muted-foreground">
                            {t.updated_date ? format(new Date(t.updated_date), 'd MMM yyyy') : '—'}
                          </td>
                          <td className="px-4 py-3 text-right">
                            <Button variant="outline" size="sm" className="text-xs gap-1" onClick={() => handleViewTenant(t)}>
                              View Tenant <ExternalLink className="w-3 h-3" />
                            </Button>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}