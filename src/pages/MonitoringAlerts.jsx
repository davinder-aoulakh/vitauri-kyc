import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import { useTenant } from '@/lib/tenantContext';
import AppShell from '@/components/layout/AppShell';
import PageHeader from '@/components/shared/PageHeader';
import KpiCard from '@/components/shared/KpiCard';
import EmptyState from '@/components/shared/EmptyState';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Shield, AlertTriangle, CheckCircle, X, ChevronDown, Loader2 } from 'lucide-react';
import { format } from 'date-fns';
import { cn } from '@/lib/utils';

export default function MonitoringAlerts() {
  const { currentUser } = useTenant();
  const navigate = useNavigate();
  const [alerts, setAlerts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState({ type: 'all', status: 'all' });
  const [expanded, setExpanded] = useState(null);
  const [justification, setJustification] = useState('');
  const [submitting, setSubmitting] = useState(null);

  useEffect(() => {
    if (currentUser?.tenant_id) loadAlerts();
  }, [currentUser]);

  async function loadAlerts() {
    const data = await base44.entities.MonitoringAlert.filter(
      { tenant_id: currentUser.tenant_id },
      '-created_date'
    );
    setAlerts(data || []);
    setLoading(false);
  }

  async function dismiss(alert) {
    if (!justification.trim()) return;
    setSubmitting(alert.id);
    await base44.entities.MonitoringAlert.update(alert.id, {
      status: 'Dismissed',
      dismissed_justification: justification,
    });
    await base44.entities.AuditEvent.create({
      tenant_id: currentUser.tenant_id,
      actor_user_id: currentUser.id,
      actor_name: currentUser.full_name,
      actor_type: 'User',
      event_type: 'monitoring_alert_dismissed',
      notes: justification,
    });
    setJustification('');
    setExpanded(null);
    await loadAlerts();
    setSubmitting(null);
  }

  async function escalateToEDR(alert) {
    setSubmitting(alert.id);
    const { addDays, format: dateFmt } = await import('date-fns');
    const dueDate = dateFmt(addDays(new Date(), 30), 'yyyy-MM-dd');
    const newCase = await base44.entities.KycCase.create({
      tenant_id: currentUser.tenant_id,
      client_id: alert.client_id,
      client_name: alert.entity_name,
      case_type: 'Event_Driven_Review',
      status: 'Draft',
      assigned_analyst_id: currentUser.id,
      trigger_reason: `Monitoring alert: ${alert.alert_type} — ${alert.source || ''}`,
      due_date: dueDate,
      created_by_user_id: currentUser.id,
    });
    await base44.entities.MonitoringAlert.update(alert.id, {
      status: 'Escalated_to_EDR',
      edr_case_id: newCase.id,
    });
    setJustification('');
    setExpanded(null);
    await loadAlerts();
    setSubmitting(null);
    navigate(`/case/${newCase.id}`);
  }

  const filtered = alerts.filter(a => {
    if (filter.type !== 'all' && a.alert_type !== filter.type) return false;
    if (filter.status !== 'all' && a.status !== filter.status) return false;
    return true;
  });

  const newAlerts = alerts.filter(a => a.status === 'New');
  const pendingReview = alerts.filter(a => a.status === 'Under_Review');

  const alertTypeColor = {
    Screening_Hit: 'bg-red-100 text-red-700',
    Register_Change: 'bg-blue-100 text-blue-700',
    Manual_Flag: 'bg-amber-100 text-amber-700',
  };

  const statusColor = {
    New: 'bg-orange-100 text-orange-700',
    Under_Review: 'bg-blue-100 text-blue-700',
    Dismissed: 'bg-slate-100 text-slate-600',
    Escalated_to_EDR: 'bg-red-100 text-red-700',
  };

  return (
    <AppShell>
      <div className="p-6 space-y-5 max-w-screen-xl mx-auto">
        <PageHeader
          title="Monitoring Alerts"
          subtitle="24/7 continuous monitoring for active clients"
        />

        {/* KPIs */}
        <div className="grid grid-cols-3 gap-4">
          <KpiCard label="New Alerts" value={loading ? '…' : newAlerts.length} icon={AlertTriangle} accentColor="#EF4444" />
          <KpiCard label="Pending Review" value={loading ? '…' : pendingReview.length} icon={Shield} accentColor="#F59E0B" />
          <KpiCard label="Total Alerts" value={loading ? '…' : alerts.length} icon={Shield} accentColor="#1A6BFF" />
        </div>

        {/* Filters */}
        <div className="flex gap-3">
          <Select value={filter.type} onValueChange={v => setFilter(f => ({ ...f, type: v }))}>
            <SelectTrigger className="h-8 text-sm w-44">
              <SelectValue placeholder="Alert Type" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Types</SelectItem>
              <SelectItem value="Screening_Hit">Screening Hit</SelectItem>
              <SelectItem value="Register_Change">Register Change</SelectItem>
              <SelectItem value="Manual_Flag">Manual Flag</SelectItem>
            </SelectContent>
          </Select>
          <Select value={filter.status} onValueChange={v => setFilter(f => ({ ...f, status: v }))}>
            <SelectTrigger className="h-8 text-sm w-40">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Statuses</SelectItem>
              <SelectItem value="New">New</SelectItem>
              <SelectItem value="Under_Review">Under Review</SelectItem>
              <SelectItem value="Dismissed">Dismissed</SelectItem>
              <SelectItem value="Escalated_to_EDR">Escalated to EDR</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Alerts List */}
        <div className="bg-card border border-border rounded-xl overflow-hidden">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
            </div>
          ) : filtered.length === 0 ? (
            <EmptyState
              icon={Shield}
              title="No monitoring alerts"
              description="All active clients are being monitored continuously."
            />
          ) : (
            <div className="divide-y divide-border">
              {filtered.map(alert => (
                <div key={alert.id}>
                  <button
                    className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-muted/30 transition-colors"
                    onClick={() => setExpanded(expanded === alert.id ? null : alert.id)}
                  >
                    <div className="flex items-center gap-3">
                      <div className="flex flex-col gap-1">
                        <span className={cn('text-xs font-medium px-2 py-0.5 rounded-full w-fit', alertTypeColor[alert.alert_type] || 'bg-slate-100 text-slate-600')}>
                          {alert.alert_type?.replace(/_/g,' ')}
                        </span>
                      </div>
                      <div>
                        <div className="text-sm font-medium text-foreground">{alert.entity_name || '—'}</div>
                        <div className="text-xs text-muted-foreground">{alert.source || '—'}</div>
                      </div>
                    </div>
                    <div className="flex items-center gap-3 flex-shrink-0">
                      <span className={cn('text-xs px-2 py-0.5 rounded-full font-medium', statusColor[alert.status] || 'bg-slate-100 text-slate-600')}>
                        {alert.status?.replace(/_/g,' ')}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {alert.created_date ? format(new Date(alert.created_date), 'd MMM') : ''}
                      </span>
                      <ChevronDown className={cn('w-4 h-4 text-muted-foreground transition-transform', expanded === alert.id && 'rotate-180')} />
                    </div>
                  </button>

                  {expanded === alert.id && alert.status === 'New' && (
                    <div className="px-4 pb-4 border-t border-border bg-muted/20">
                      <div className="pt-3 space-y-3">
                        {alert.ai_impact_summary && (
                          <div className="bg-purple-50 border border-purple-100 rounded-lg p-3 text-xs text-purple-900">
                            <strong>AI Impact Summary:</strong> {alert.ai_impact_summary}
                          </div>
                        )}
                        <Textarea
                          value={justification}
                          onChange={e => setJustification(e.target.value)}
                          placeholder="Justification required for dismissal…"
                          className="text-xs min-h-12"
                        />
                        <div className="flex gap-2">
                          <Button size="sm" variant="outline" className="text-xs gap-1 text-green-700 border-green-300 hover:bg-green-50" onClick={() => dismiss(alert)} disabled={!justification.trim() || submitting === alert.id}>
                            <CheckCircle className="w-3 h-3" /> Dismiss — No Impact
                          </Button>
                          <Button size="sm" className="text-xs gap-1 bg-red-600 hover:bg-red-700 text-white" onClick={() => escalateToEDR(alert)} disabled={submitting === alert.id}>
                            {submitting === alert.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <AlertTriangle className="w-3 h-3" />}
                            Escalate to EDR
                          </Button>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </AppShell>
  );
}