import React, { useState, useEffect, useRef, useCallback } from 'react';
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
import WorkflowOptimisationWidget from '@/components/dashboard/WorkflowOptimisationWidget';
import {
  FolderOpen, UserCircle, AlertTriangle, Shield, Calendar,
  Plus, ChevronRight, RefreshCw
} from 'lucide-react';
import { format, isAfter, addDays, differenceInDays } from 'date-fns';
import { cn } from '@/lib/utils';

const PIPELINE_STATUSES = [
  { key: 'Draft',           label: 'Draft' },
  { key: 'In_Progress',     label: 'In Progress' },
  { key: 'Outreach_Pending',label: 'Outreach' },
  { key: 'Screening',       label: 'Screening' },
  { key: 'Assessment',      label: 'Assessment' },
  { key: 'QC',              label: 'QC' },
  { key: 'Sign_Off_Pending',label: 'Sign-Off' },
  { key: 'Approved',        label: 'Approved' },
];

const CLOSED_STATUSES = ['Approved', 'Closed', 'Rejected'];

export default function Dashboard() {
  const { currentUser, tenant } = useTenant();
  const navigate = useNavigate();
  const [cases, setCases] = useState([]);
  const [clients, setClients] = useState({});   // id → client record
  const [users, setUsers] = useState([]);
  const [auditEvents, setAuditEvents] = useState([]);
  const [screeningAlerts, setScreeningAlerts] = useState(0);
  const [loading, setLoading] = useState(true);
  const refreshTimer = useRef(null);

  const tenantColor = tenant?.branding_primary_color || '#1A6BFF';
  const userRole = currentUser?.app_role;
  const isManager = hasPermission(userRole, 'viewAllTenantCases');

  const loadData = useCallback(async () => {
    if (!currentUser?.tenant_id) return;
    const [casesData, auditData, clientsData, newHits, reviewHits, usersData] = await Promise.all([
      base44.entities.KycCase.filter({ tenant_id: currentUser.tenant_id }),
      base44.entities.AuditEvent.filter({ tenant_id: currentUser.tenant_id }, '-created_date', 20),
      base44.entities.Client.filter({ tenant_id: currentUser.tenant_id }),
      base44.entities.ScreeningHit.filter({ tenant_id: currentUser.tenant_id, status: 'New' }),
      base44.entities.ScreeningHit.filter({ tenant_id: currentUser.tenant_id, status: 'Under_Review' }),
      base44.entities.User.list(),
    ]);
    setCases(casesData || []);
    setAuditEvents(auditData || []);
    setScreeningAlerts((newHits?.length || 0) + (reviewHits?.length || 0));
    setUsers(usersData || []);
    // Build client lookup map
    const clientMap = {};
    (clientsData || []).forEach(c => { clientMap[c.id] = c; });
    setClients(clientMap);
    setLoading(false);
  }, [currentUser?.tenant_id]);

  // Initial load + 60s auto-refresh
  useEffect(() => {
    if (!currentUser?.tenant_id) return;
    loadData();
    refreshTimer.current = setInterval(loadData, 60000);
    return () => clearInterval(refreshTimer.current);
  }, [loadData]);

  const today = new Date();
  const openCases    = cases.filter(c => !CLOSED_STATUSES.includes(c.status));
  const myCases      = cases.filter(c => c.assigned_analyst_id === currentUser?.id && !CLOSED_STATUSES.includes(c.status));
  const overdueCases = openCases.filter(c => c.due_date && isAfter(today, new Date(c.due_date)));

  // Reviews Due (30d) — based on Client.next_review_date
  const clientsWithReviewDue = Object.values(clients).filter(cl => {
    if (!cl.next_review_date) return false;
    const d = new Date(cl.next_review_date);
    return d >= today && d <= addDays(today, 30);
  });

  // Table cases: Analysts see only their own; Managers+ see all open
  const tableCases = isManager ? openCases : myCases;
  // Sort by due_date ascending (nulls last)
  const sortedTableCases = [...tableCases].sort((a, b) => {
    if (!a.due_date && !b.due_date) return 0;
    if (!a.due_date) return 1;
    if (!b.due_date) return -1;
    return new Date(a.due_date) - new Date(b.due_date);
  });

  const pipelineCounts = PIPELINE_STATUSES.map(s => ({
    ...s,
    count: cases.filter(c => c.status === s.key).length,
  }));
  const pipelineMax = Math.max(...pipelineCounts.map(s => s.count), 1);

  return (
    <AppShell>
      <div className="p-6 space-y-5 max-w-screen-2xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold text-foreground">Portfolio Dashboard</h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              {format(today, 'EEEE d MMMM yyyy')} · {tenant?.name}
            </p>
          </div>
          {hasPermission(userRole, 'createEditClient') && (
            <Button onClick={() => navigate('/new-client')} className="gap-2" style={{ backgroundColor: tenantColor }}>
              <Plus className="w-4 h-4" /> New Client
            </Button>
          )}
        </div>

        {/* KPI Tiles */}
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
          <KpiCard
            label="Open Cases"
            value={loading ? '…' : openCases.length}
            subtitle={`${cases.filter(c => c.status === 'In_Progress').length} in progress`}
            icon={FolderOpen}
            accentColor={tenantColor}
            onClick={isManager ? () => navigate('/all-cases') : undefined}
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
            onClick={isManager ? () => navigate('/all-cases') : undefined}
          />
          <KpiCard
            label="Screening Alerts"
            value={loading ? '…' : screeningAlerts}
            subtitle="New + under review"
            icon={Shield}
            accentColor="#F59E0B"
            onClick={() => navigate('/monitoring')}
          />
          <KpiCard
            label="Reviews Due (30d)"
            value={loading ? '…' : clientsWithReviewDue.length}
            subtitle={clientsWithReviewDue.length > 0 ? `Next: ${format(new Date(clientsWithReviewDue[0].next_review_date), 'd MMM')}` : 'None upcoming'}
            icon={Calendar}
            accentColor="#10B981"
          />
        </div>

        {/* Pipeline */}
        <div className="bg-card rounded-xl border border-border p-4">
          <h2 className="text-sm font-semibold text-foreground mb-4">Case Status Pipeline</h2>
          <div className="grid grid-cols-4 md:grid-cols-8 gap-2">
            {pipelineCounts.map((s) => {
              const barHeight = Math.round((s.count / pipelineMax) * 48);
              const isActive = s.count > 0;
              return (
                <div
                  key={s.key}
                  className={cn(
                    'flex flex-col items-center gap-1.5 py-3 px-2 rounded-lg border cursor-pointer transition-colors',
                    isActive ? 'bg-primary/5 border-primary/20 hover:bg-primary/10' : 'bg-muted/30 border-border hover:bg-muted/50'
                  )}
                  onClick={() => isManager && navigate(`/all-cases?status=${s.key}`)}
                >
                  <span className={cn('text-2xl font-bold tabular-nums', isActive ? 'text-primary' : 'text-muted-foreground')}>
                    {loading ? '…' : s.count}
                  </span>
                  <span className="text-xs text-muted-foreground text-center leading-tight">{s.label}</span>
                </div>
              );
            })}
          </div>
        </div>

        {/* Workflow Optimisation Widget — Manager+ only */}
        {isManager && (
          <WorkflowOptimisationWidget
            cases={openCases}
            clients={clients}
            users={users}
            currentUser={currentUser}
            tenantId={currentUser?.tenant_id}
            onNavigate={path => navigate(path)}
          />
        )}

        {/* Cases Table + Activity Feed */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">

          {/* Cases Table */}
          <div className="lg:col-span-2 bg-card rounded-xl border border-border overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b border-border">
              <div>
                <span className="font-semibold text-sm">{isManager ? 'All Open Cases' : 'My Cases'}</span>
                <span className="ml-2 text-xs text-muted-foreground">
                  {sortedTableCases.length} {isManager ? 'open cases' : 'assigned to you'}
                </span>
              </div>
              {isManager && (
                <Button variant="ghost" size="sm" onClick={() => navigate('/all-cases')} className="gap-1 text-xs">
                  View All <ChevronRight className="w-3 h-3" />
                </Button>
              )}
            </div>

            {loading ? (
              <div className="p-8 text-center text-muted-foreground text-sm">Loading cases…</div>
            ) : sortedTableCases.length === 0 ? (
              <EmptyState icon={FolderOpen} title="No cases assigned" description="Cases assigned to you will appear here." />
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
                      <th className="text-left px-4 py-2.5">Days Open</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {sortedTableCases.slice(0, 10).map(c => (
                      <CaseRow
                        key={c.id}
                        caseItem={c}
                        client={clients[c.client_id]}
                        onOpen={() => navigate(`/case/${c.id}`)}
                      />
                    ))}
                  </tbody>
                </table>
                {sortedTableCases.length > 10 && (
                  <div className="px-4 py-3 border-t border-border flex items-center justify-between">
                    <span className="text-xs text-muted-foreground">Showing 10 of {sortedTableCases.length}</span>
                    {isManager && (
                      <Button variant="ghost" size="sm" className="text-xs gap-1" onClick={() => navigate('/all-cases')}>
                        View All <ChevronRight className="w-3 h-3" />
                      </Button>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Recent Activity */}
          <div className="bg-card rounded-xl border border-border overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b border-border">
              <div>
                <span className="font-semibold text-sm">Recent Activity</span>
                <span className="ml-2 text-xs text-muted-foreground">Auto-refreshes every 60s</span>
              </div>
              <button onClick={loadData} className="text-muted-foreground hover:text-foreground transition-colors" title="Refresh now">
                <RefreshCw className="w-3.5 h-3.5" />
              </button>
            </div>
            <div className="divide-y divide-border overflow-y-auto" style={{ maxHeight: 440 }}>
              {auditEvents.length === 0 ? (
                <div className="py-8 text-center text-muted-foreground text-xs">No recent activity</div>
              ) : (
                auditEvents.map(event => (
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

function CaseRow({ caseItem, client, onOpen }) {
  const today = new Date();
  const isOverdue = caseItem.due_date && isAfter(today, new Date(caseItem.due_date)) &&
    !CLOSED_STATUSES.includes(caseItem.status);
  const daysOpen = differenceInDays(today, new Date(caseItem.created_date || today));

  return (
    <tr className="hover:bg-muted/30 transition-colors cursor-pointer" onClick={onOpen}>
      <td className="px-4 py-3 font-medium text-foreground text-sm max-w-[160px] truncate">
        {client?.full_name || '—'}
      </td>
      <td className="px-4 py-3">
        <span className={cn(
          'text-xs font-medium px-1.5 py-0.5 rounded',
          client?.client_type === 'ORG' ? 'bg-blue-100 text-blue-700' : 'bg-violet-100 text-violet-700'
        )}>
          {client?.client_type || '—'}
        </span>
      </td>
      <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">
        {caseItem.case_type?.replace(/_/g, ' ') || '—'}
      </td>
      <td className="px-4 py-3">
        <StatusBadge status={caseItem.status} />
      </td>
      <td className="px-4 py-3">
        <RiskBadge risk={caseItem.risk_classification} />
      </td>
      <td className={cn('px-4 py-3 text-xs whitespace-nowrap', isOverdue ? 'text-red-600 font-semibold' : 'text-muted-foreground')}>
        {caseItem.due_date ? format(new Date(caseItem.due_date), 'd MMM yy') : '—'}
        {isOverdue && ' ⚠'}
      </td>
      <td className="px-4 py-3 text-xs text-muted-foreground tabular-nums">
        {daysOpen}d
      </td>
    </tr>
  );
}

function ActivityItem({ event }) {
  const actorColor =
    event.actor_type === 'AI_Agent' ? 'text-purple-600' :
    event.actor_type === 'System'   ? 'text-blue-500'   :
    'text-foreground';

  const eventLabel = event.event_type?.replace(/_/g, ' ');
  const timeLabel  = event.created_date
    ? format(new Date(event.created_date), 'HH:mm')
    : '';
  const dateLabel  = event.created_date
    ? format(new Date(event.created_date), 'd MMM')
    : '';

  return (
    <div className="px-4 py-2.5 hover:bg-muted/30 transition-colors">
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <p className="text-xs leading-snug">
            <span className={cn('font-medium', actorColor)}>
              {event.actor_name || event.actor_type}
            </span>
            <span className="text-muted-foreground"> · {eventLabel}</span>
          </p>
          {event.notes && (
            <p className="text-xs text-muted-foreground/70 mt-0.5 truncate">{event.notes}</p>
          )}
        </div>
        <div className="flex-shrink-0 text-right">
          <div className="text-xs text-muted-foreground/60">{timeLabel}</div>
          <div className="text-xs text-muted-foreground/40">{dateLabel}</div>
        </div>
      </div>
    </div>
  );
}