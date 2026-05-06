import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import { useTenant } from '@/lib/tenantContext';
import { hasPermission } from '@/lib/permissions';
import AppShell from '@/components/layout/AppShell';
import KpiCard from '@/components/shared/KpiCard';
import RiskBadge from '@/components/shared/RiskBadge';
import StatusBadge from '@/components/shared/StatusBadge';
import EmptyState from '@/components/shared/EmptyState';
import { Button } from '@/components/ui/button';
import {
  FolderOpen, UserCircle, AlertTriangle, Shield, Calendar,
  Plus, ChevronRight, RefreshCw
} from 'lucide-react';
import { format, isAfter, addDays } from 'date-fns';
import { cn } from '@/lib/utils';

const PIPELINE_STATUSES = [
  { key: 'Draft', label: 'Draft' },
  { key: 'In_Progress', label: 'In Progress' },
  { key: 'Outreach_Pending', label: 'Outreach' },
  { key: 'Screening', label: 'Screening' },
  { key: 'Assessment', label: 'Assessment' },
  { key: 'QC', label: 'QC Review' },
  { key: 'Sign_Off_Pending', label: 'Sign-Off' },
];

export default function Dashboard() {
  const { currentUser, tenant } = useTenant();
  const navigate = useNavigate();
  const [cases, setCases] = useState([]);
  const [auditEvents, setAuditEvents] = useState([]);
  const [screeningHits, setScreeningHits] = useState([]);
  const [loading, setLoading] = useState(true);
  const tenantColor = tenant?.branding_primary_color || '#1A6BFF';
  const userRole = currentUser?.app_role;

  useEffect(() => {
    if (currentUser?.tenant_id) loadData();
  }, [currentUser]);

  async function loadData() {
    setLoading(true);
    const [casesData, auditData, hitsData] = await Promise.all([
      base44.entities.KycCase.filter({ tenant_id: currentUser.tenant_id }),
      base44.entities.AuditEvent.filter({ tenant_id: currentUser.tenant_id }, '-created_date', 20),
      base44.entities.ScreeningHit.filter({ tenant_id: currentUser.tenant_id, status: 'New' }),
    ]);
    setCases(casesData || []);
    setAuditEvents(auditData || []);
    setScreeningHits(hitsData || []);
    setLoading(false);
  }

  const today = new Date();
  const openCases = cases.filter(c => !['Approved', 'Closed', 'Rejected'].includes(c.status));
  const myCases = cases.filter(c => c.assigned_analyst_id === currentUser?.id && !['Approved', 'Closed', 'Rejected'].includes(c.status));
  const overdueCases = cases.filter(c => c.due_date && isAfter(today, new Date(c.due_date)) && !['Approved', 'Closed', 'Rejected'].includes(c.status));
  const reviewsDue = cases.filter(c => {
    if (!c.due_date) return false;
    const due = new Date(c.due_date);
    return due >= today && due <= addDays(today, 30) && !['Approved', 'Closed', 'Rejected'].includes(c.status);
  });

  const displayCases = hasPermission(userRole, 'viewAllTenantCases') ? myCases : myCases;

  const pipelineCounts = PIPELINE_STATUSES.map(s => ({
    ...s,
    count: openCases.filter(c => c.status === s.key).length,
  }));

  return (
    <AppShell>
      <div className="p-6 space-y-6 max-w-screen-2xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold text-foreground">Portfolio Dashboard</h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              {format(today, 'EEEE d MMMM yyyy')} — {tenant?.name}
            </p>
          </div>
          <Button
            onClick={() => navigate('/new-client')}
            className="gap-2"
            style={{ backgroundColor: tenantColor }}
          >
            <Plus className="w-4 h-4" />
            New Client
          </Button>
        </div>

        {/* KPI Tiles */}
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
          <KpiCard
            label="Open Cases"
            value={loading ? '…' : openCases.length}
            icon={FolderOpen}
            accentColor={tenantColor}
            onClick={() => navigate('/all-cases')}
          />
          <KpiCard
            label="My Cases"
            value={loading ? '…' : myCases.length}
            subtitle={`${myCases.filter(c => c.due_date && new Date(c.due_date).toDateString() === today.toDateString()).length} due today`}
            icon={UserCircle}
            accentColor="#8B5CF6"
          />
          <KpiCard
            label="Overdue"
            value={loading ? '…' : overdueCases.length}
            subtitle="Requires attention"
            icon={AlertTriangle}
            accentColor="#EF4444"
          />
          <KpiCard
            label="Screening Alerts"
            value={loading ? '…' : screeningHits.length}
            icon={Shield}
            accentColor="#F59E0B"
            onClick={() => navigate('/monitoring')}
          />
          <KpiCard
            label="Reviews Due (30d)"
            value={loading ? '…' : reviewsDue.length}
            subtitle={reviewsDue.length > 0 ? `Next: ${format(new Date(reviewsDue[0]?.due_date || today), 'd MMM')}` : ''}
            icon={Calendar}
            accentColor="#10B981"
          />
        </div>

        {/* Pipeline */}
        <div className="bg-card rounded-xl border border-border p-4">
          <h2 className="text-sm font-semibold text-foreground mb-3">Case Status Pipeline</h2>
          <div className="grid grid-cols-4 md:grid-cols-7 gap-2">
            {pipelineCounts.map((s, i) => (
              <div
                key={s.key}
                className={cn(
                  'flex flex-col items-center py-3 px-2 rounded-lg border cursor-pointer transition-colors',
                  s.count > 0 ? 'bg-primary/5 border-primary/20 hover:bg-primary/10' : 'bg-muted/30 border-border hover:bg-muted/50'
                )}
                onClick={() => navigate(`/all-cases?status=${s.key}`)}
              >
                <span className={cn('text-2xl font-bold', s.count > 0 ? 'text-primary' : 'text-muted-foreground')}>
                  {loading ? '…' : s.count}
                </span>
                <span className="text-xs text-muted-foreground text-center mt-1 leading-tight">{s.label}</span>
              </div>
            ))}
          </div>
        </div>

        {/* My Cases + Recent Activity */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Cases Table */}
          <div className="lg:col-span-2 bg-card rounded-xl border border-border overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b border-border">
              <div>
                <span className="font-semibold text-sm">My Cases</span>
                <span className="ml-2 text-xs text-muted-foreground">{myCases.length} cases assigned to you</span>
              </div>
              {hasPermission(userRole, 'viewAllTenantCases') && (
                <Button variant="ghost" size="sm" onClick={() => navigate('/all-cases')} className="gap-1 text-xs">
                  View All <ChevronRight className="w-3 h-3" />
                </Button>
              )}
            </div>
            {loading ? (
              <div className="p-8 text-center text-muted-foreground text-sm">Loading cases…</div>
            ) : myCases.length === 0 ? (
              <EmptyState
                icon={FolderOpen}
                title="No cases assigned"
                description="Cases assigned to you will appear here."
              />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-muted/40 border-b border-border text-xs text-muted-foreground uppercase tracking-wide">
                      <th className="text-left px-4 py-2.5">Client</th>
                      <th className="text-left px-4 py-2.5">Type</th>
                      <th className="text-left px-4 py-2.5">Case Type</th>
                      <th className="text-left px-4 py-2.5">Status</th>
                      <th className="text-left px-4 py-2.5">Risk</th>
                      <th className="text-left px-4 py-2.5">Due</th>
                      <th className="px-4 py-2.5"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {myCases.slice(0, 8).map((c) => (
                      <CaseRow key={c.id} caseItem={c} tenantColor={tenantColor} onOpen={() => navigate(`/case/${c.id}`)} />
                    ))}
                  </tbody>
                </table>
                {myCases.length > 8 && (
                  <div className="px-4 py-3 text-center text-xs text-muted-foreground border-t border-border">
                    Showing 8 of {myCases.length} cases
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Recent Activity */}
          <div className="bg-card rounded-xl border border-border overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b border-border">
              <span className="font-semibold text-sm">Recent Activity</span>
              <button onClick={loadData} className="text-muted-foreground hover:text-foreground transition-colors">
                <RefreshCw className="w-3.5 h-3.5" />
              </button>
            </div>
            <div className="divide-y divide-border max-h-96 overflow-y-auto">
              {auditEvents.length === 0 ? (
                <div className="py-8 text-center text-muted-foreground text-xs">No recent activity</div>
              ) : (
                auditEvents.map((event) => (
                  <ActivityItem key={event.id} event={event} />
                ))
              )}
            </div>
          </div>
        </div>
      </div>
    </AppShell>
  );
}

function CaseRow({ caseItem, tenantColor, onOpen }) {
  const today = new Date();
  const isOverdue = caseItem.due_date && isAfter(today, new Date(caseItem.due_date)) &&
    !['Approved', 'Closed', 'Rejected'].includes(caseItem.status);

  return (
    <tr className="hover:bg-muted/30 transition-colors cursor-pointer" onClick={onOpen}>
      <td className="px-4 py-3 font-medium text-foreground text-sm">
        {caseItem.client_name || caseItem.client_id?.slice(0, 8) + '…'}
      </td>
      <td className="px-4 py-3">
        <span className={cn(
          'text-xs font-medium px-1.5 py-0.5 rounded',
          caseItem.client_type === 'ORG' ? 'bg-blue-100 text-blue-700' : 'bg-violet-100 text-violet-700'
        )}>
          {caseItem.client_type || '—'}
        </span>
      </td>
      <td className="px-4 py-3 text-xs text-muted-foreground">
        {caseItem.case_type?.replace(/_/g, ' ') || '—'}
      </td>
      <td className="px-4 py-3">
        <StatusBadge status={caseItem.status} />
      </td>
      <td className="px-4 py-3">
        <RiskBadge risk={caseItem.risk_classification} />
      </td>
      <td className={cn('px-4 py-3 text-xs', isOverdue ? 'text-red-600 font-semibold' : 'text-muted-foreground')}>
        {caseItem.due_date ? format(new Date(caseItem.due_date), 'd MMM yyyy') : '—'}
      </td>
      <td className="px-4 py-3">
        <button className="text-xs text-primary hover:text-primary/80 font-medium whitespace-nowrap">
          Open →
        </button>
      </td>
    </tr>
  );
}

function ActivityItem({ event }) {
  const actorColor = event.actor_type === 'AI_Agent'
    ? 'text-purple-600'
    : event.actor_type === 'System'
      ? 'text-blue-600'
      : 'text-foreground';

  return (
    <div className="px-4 py-3 hover:bg-muted/30 transition-colors">
      <div className="flex items-start gap-2">
        <div className="flex-1 min-w-0">
          <p className="text-xs text-muted-foreground leading-relaxed">
            <span className={cn('font-medium', actorColor)}>
              {event.actor_name || event.actor_type}
            </span>
            {' · '}
            {event.event_type?.replace(/_/g, ' ')}
          </p>
          {event.notes && (
            <p className="text-xs text-muted-foreground/70 mt-0.5 truncate">{event.notes}</p>
          )}
        </div>
        <span className="text-xs text-muted-foreground/60 flex-shrink-0">
          {event.created_date ? format(new Date(event.created_date), 'HH:mm') : ''}
        </span>
      </div>
    </div>
  );
}