import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import { useTenant } from '@/lib/tenantContext';
import AppShell from '@/components/layout/AppShell';
import PageHeader from '@/components/shared/PageHeader';
import KpiCard from '@/components/shared/KpiCard';
import EmptyState from '@/components/shared/EmptyState';
import AlertDetailPanel from '@/components/monitoring/AlertDetailPanel';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { Shield, AlertTriangle, Flag, Search, Plus, Loader2, ChevronRight } from 'lucide-react';
import { format, startOfMonth, isWithinInterval } from 'date-fns';
import { cn } from '@/lib/utils';
import { useTenantClients } from '@/hooks/useTenantData';

const ALERT_TYPE_STYLE = {
  Screening_Hit:   'bg-red-100 text-red-700 border-red-200',
  Register_Change: 'bg-blue-100 text-blue-700 border-blue-200',
  Manual_Flag:     'bg-amber-100 text-amber-700 border-amber-200',
  Didit_Ongoing_PEP:           'bg-purple-100 text-purple-700 border-purple-200',
  Didit_Ongoing_Sanctions:     'bg-red-100 text-red-700 border-red-200',
  Didit_Ongoing_Adverse_Media: 'bg-orange-100 text-orange-700 border-orange-200',
  Didit_Ongoing_High_Risk:     'bg-amber-100 text-amber-700 border-amber-200',
  Didit_Abandoned:             'bg-slate-100 text-slate-600 border-slate-200',
};
const STATUS_STYLE = {
  New:              'bg-orange-100 text-orange-700',
  Under_Review:     'bg-blue-100 text-blue-700',
  Dismissed:        'bg-slate-100 text-slate-500',
  Escalated_to_EDR: 'bg-red-100 text-red-700',
};

// Neutral token-based pill for the "Didit" source badge — used in both the tabs and table rows.
const DIDIT_BADGE_CLASS = 'text-[10px] leading-none font-bold tracking-[0.055em] text-muted-foreground bg-muted border border-border rounded-md px-1.5 py-1';

// A Didit-sourced alert is one created by ongoing monitoring / KYC webhooks —
// source strings vary ('Didit_Ongoing_Monitoring', 'Didit Ongoing Monitoring',
// 'Didit KYC', 'Didit KYC Expiry') so match loosely, plus any Didit_* alert_type.
const isDiditSource = (a) => /^didit/i.test(a?.source || '') || (a?.alert_type || '').startsWith('Didit_');
const sourceLabel = (a) => isDiditSource(a) ? 'Didit' : (a?.source || '—');

// Category matchers — combine legacy source-based alerts with Didit alert_type-based alerts
const pepMatch           = (a) => a.source === 'PEP_List' || a.alert_type === 'Didit_Ongoing_PEP';
const sanctionsMatch     = (a) => ['Sanctions_EU', 'Sanctions_UN'].includes(a.source) || a.alert_type === 'Didit_Ongoing_Sanctions';
const adverseMediaMatch  = (a) => a.source === 'Adverse_Media' || a.alert_type === 'Didit_Ongoing_Adverse_Media';
const otherMatch         = (a) => ['Internal_Flag', 'Register_Change'].includes(a.source) || ['Didit_Ongoing_High_Risk', 'Didit_Abandoned'].includes(a.alert_type);

export default function MonitoringAlerts() {
  const { currentUser } = useTenant();
  const navigate = useNavigate();
  const [alerts, setAlerts]       = useState([]);
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState(null);
  const { data: activeClients = [] } = useTenantClients(currentUser?.tenant_id);
  const clients = useMemo(() => activeClients.filter(c => c.status === 'Active'), [activeClients]);
  const [sourceTab, setSourceTab] = useState('all');
  const [filter, setFilter]       = useState({ type: 'all', status: 'all', client: 'all', search: '' });
  const [selected, setSelected]   = useState(null);
  const [manualFlag, setManualFlag] = useState(false);
  const [flagForm, setFlagForm]   = useState({ client_id: '', reason: '' });
  const [flagging, setFlagging]   = useState(false);

  useEffect(() => {
    if (currentUser?.tenant_id) loadAll();
  }, [currentUser]);

  async function loadAll() {
    setLoading(true);
    setError(null);
    try {
      const alertData = await base44.entities.MonitoringAlert.filter({ tenant_id: currentUser.tenant_id }, '-created_date');
      setAlerts(alertData || []);
    } catch (err) {
      console.error('MonitoringAlerts loadAll error:', err);
      setError(err?.message || 'Failed to load monitoring data');
    } finally {
      setLoading(false);
    }
  }

  async function createManualFlag() {
    if (!flagForm.client_id || !flagForm.reason.trim()) return;
    setFlagging(true);
    const clientObj = clients.find(c => c.id === flagForm.client_id);
    await base44.entities.MonitoringAlert.create({
      tenant_id: currentUser.tenant_id,
      client_id: flagForm.client_id,
      entity_name: clientObj?.full_name || '—',
      entity_type: 'Client',
      alert_type: 'Manual_Flag',
      source: `Manual flag by ${currentUser.full_name}`,
      details: { reason: flagForm.reason, flagged_by: currentUser.full_name },
      status: 'New',
    });
    await base44.entities.AuditEvent.create({
      tenant_id: currentUser.tenant_id,
      actor_user_id: currentUser.id,
      actor_name: currentUser.full_name,
      actor_type: 'User',
      event_type: 'manual_flag_created',
      notes: flagForm.reason,
    });
    setFlagForm({ client_id: '', reason: '' });
    setManualFlag(false);
    setFlagging(false);
    loadAll();
  }

  // KPIs
  const now = new Date();
  const monthStart = startOfMonth(now);
  const today = new Date(); today.setHours(0,0,0,0);
  const newToday = alerts.filter(a => {
    if (a.status !== 'New') return false;
    const d = a.created_date ? new Date(a.created_date) : null;
    return d && d >= today;
  }).length;
  const pendingReview = alerts.filter(a => ['New','Under_Review'].includes(a.status)).length;
  const edrThisMonth = alerts.filter(a => {
    if (a.status !== 'Escalated_to_EDR') return false;
    const d = a.created_date ? new Date(a.created_date) : null;
    return d && isWithinInterval(d, { start: monthStart, end: now });
  }).length;

  const SOURCE_TABS = [
    { value: 'all',          label: 'All Sources',  match: () => true,       didit: false },
    { value: 'PEP',          label: 'PEP',           match: pepMatch,          didit: true },
    { value: 'Sanctions',    label: 'Sanctions',     match: sanctionsMatch,    didit: true },
    { value: 'Adverse_Media',label: 'Adverse Media', match: adverseMediaMatch, didit: true },
    { value: 'Other',        label: 'Other',         match: otherMatch,        didit: false },
  ];

  const pepCount      = alerts.filter(pepMatch).length;
  const sanctionCount = alerts.filter(sanctionsMatch).length;
  const mediaCount    = alerts.filter(adverseMediaMatch).length;

  const activeTab = SOURCE_TABS.find(t => t.value === sourceTab);

  const filtered = alerts.filter(a => {
    if (sourceTab !== 'all' && activeTab && !activeTab.match(a)) return false;
    if (filter.type !== 'all' && a.alert_type !== filter.type) return false;
    if (filter.status !== 'all' && a.status !== filter.status) return false;
    if (filter.client !== 'all' && a.client_id !== filter.client) return false;
    if (filter.search && !a.entity_name?.toLowerCase().includes(filter.search.toLowerCase())) return false;
    return true;
  });

  return (
    <AppShell>
      <div className="p-6 space-y-5 max-w-screen-xl mx-auto">
        <PageHeader
          title="Monitoring Alerts"
          subtitle="Continuous monitoring for PEP/sanctions changes, register updates, and manual flags"
          actions={
            <Button size="sm" className="gap-1.5 text-xs" onClick={() => setManualFlag(true)}>
              <Flag className="w-3.5 h-3.5" /> Manual Flag
            </Button>
          }
        />

        {/* Error banner */}
        {error && (
          <div className="flex items-center gap-3 bg-destructive/10 border border-destructive/30 rounded-xl px-4 py-3">
            <AlertTriangle className="w-4 h-4 text-destructive flex-shrink-0" />
            <span className="text-sm text-destructive flex-1">{error}</span>
            <Button size="sm" variant="outline" onClick={loadAll}>Retry</Button>
          </div>
        )}

        {/* KPIs */}
        <div className="grid grid-cols-3 sm:grid-cols-6 gap-3">
          <KpiCard label="New Alerts Today"        value={loading ? '…' : newToday}      icon={AlertTriangle} accent="bg-destructive" />
          <KpiCard label="Alerts Pending Review"   value={loading ? '…' : pendingReview} icon={Shield}        accent="bg-warning" />
          <KpiCard label="EDR Cases This Month"    value={loading ? '…' : edrThisMonth}  icon={AlertTriangle} accent="bg-primary" />
          <KpiCard label="PEP Hits"                value={loading ? '…' : pepCount}      icon={Shield}        accent="bg-risk-unacceptable" />
          <KpiCard label="Sanctions Hits"          value={loading ? '…' : sanctionCount} icon={AlertTriangle} accent="bg-destructive" />
          <KpiCard label="Adverse Media"           value={loading ? '…' : mediaCount}    icon={Flag}          accent="bg-warning" />
        </div>

        {/* Source tabs */}
        <div className="w-full flex items-center gap-2 p-3 bg-card border border-border rounded-xl flex-wrap">
          {SOURCE_TABS.map(tab => {
            const count = tab.value === 'all' ? alerts.length : alerts.filter(tab.match).length;
            const isSelected = sourceTab === tab.value;
            return (
              <button
                key={tab.value}
                type="button"
                onClick={() => setSourceTab(tab.value)}
                className={cn(
                  'relative flex items-center gap-2 px-4 py-2.5 rounded-lg border text-sm font-medium whitespace-nowrap transition-colors',
                  isSelected
                    ? 'bg-primary border-primary text-primary-foreground shadow-sm'
                    : 'bg-card border-border text-muted-foreground hover:bg-muted hover:text-foreground'
                )}
              >
                {tab.label}
                {tab.didit && (
                  <span className={cn(DIDIT_BADGE_CLASS, isSelected && 'text-primary-foreground bg-white/15 border-white/20')}>
                    Didit
                  </span>
                )}
                <span className={cn(
                  'text-xs rounded-full px-1.5 font-semibold',
                  isSelected ? 'bg-white/20 text-primary-foreground' : 'bg-primary/10 text-primary'
                )}>
                  {count}
                </span>
              </button>
            );
          })}
        </div>

        {/* Filters */}
        <div className="flex gap-3 flex-wrap">
          <div className="relative">
            <Search className="w-3.5 h-3.5 absolute left-2.5 top-2 text-muted-foreground" />
            <Input
              placeholder="Search entity…"
              value={filter.search}
              onChange={e => setFilter(f => ({ ...f, search: e.target.value }))}
              className="h-8 text-xs pl-8 w-48"
            />
          </div>
          <Select value={filter.type} onValueChange={v => setFilter(f => ({ ...f, type: v }))}>
            <SelectTrigger className="h-8 text-xs w-44"><SelectValue placeholder="Alert Type" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Types</SelectItem>
              <SelectItem value="Screening_Hit">Screening Hit</SelectItem>
              <SelectItem value="Register_Change">Register Change</SelectItem>
              <SelectItem value="Manual_Flag">Manual Flag</SelectItem>
            </SelectContent>
          </Select>
          <Select value={filter.status} onValueChange={v => setFilter(f => ({ ...f, status: v }))}>
            <SelectTrigger className="h-8 text-xs w-40"><SelectValue placeholder="Status" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Statuses</SelectItem>
              <SelectItem value="New">New</SelectItem>
              <SelectItem value="Under_Review">Under Review</SelectItem>
              <SelectItem value="Dismissed">Dismissed</SelectItem>
              <SelectItem value="Escalated_to_EDR">Escalated to EDR</SelectItem>
            </SelectContent>
          </Select>
          <Select value={filter.client} onValueChange={v => setFilter(f => ({ ...f, client: v }))}>
            <SelectTrigger className="h-8 text-xs w-48"><SelectValue placeholder="Client" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Clients</SelectItem>
              {clients.map(c => <SelectItem key={c.id} value={c.id}>{c.full_name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>

        {/* Alerts Table */}
        <div className="bg-card border border-border rounded-xl overflow-hidden">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
            </div>
          ) : filtered.length === 0 ? (
            <EmptyState icon={Shield} title="No monitoring alerts" description="All active clients are being monitored." />
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-muted/40 border-b border-border text-xs text-muted-foreground uppercase tracking-wide">
                  <th className="text-left px-4 py-3">Client / Entity</th>
                  <th className="text-left px-4 py-3">Alert Type</th>
                  <th className="text-left px-4 py-3">Source</th>
                  <th className="text-left px-4 py-3">Detected</th>
                  <th className="text-left px-4 py-3">Status</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {filtered.map(alert => (
                  <tr
                    key={alert.id}
                    className={cn(
                      'hover:bg-muted/20 transition-colors cursor-pointer',
                      alert.status === 'New' && 'bg-warning/5'
                    )}
                    onClick={() => setSelected(alert)}
                  >
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1.5">
                        <span className="font-medium text-xs text-foreground">{alert.entity_name || '—'}</span>
                        {isDiditSource(alert) && (
                          <span className={DIDIT_BADGE_CLASS}>Didit</span>
                        )}
                      </div>
                      <div className="text-xs text-muted-foreground">{alert.entity_type?.replace(/_/g,' ')}</div>
                    </td>
                    <td className="px-4 py-3">
                      <span className={cn('text-xs font-medium px-2 py-0.5 rounded-full border', ALERT_TYPE_STYLE[alert.alert_type])}>
                        {alert.alert_type?.replace(/_/g,' ')}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">{sourceLabel(alert)}</td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">
                      {alert.created_date ? format(new Date(alert.created_date), 'd MMM yyyy') : '—'}
                    </td>
                    <td className="px-4 py-3">
                      <span className={cn('text-xs px-2 py-0.5 rounded-full font-medium', STATUS_STYLE[alert.status])}>
                        {alert.status?.replace(/_/g,' ')}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <ChevronRight className="w-4 h-4 text-muted-foreground inline" />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* Alert Detail Slide-over */}
      {selected && (
        <AlertDetailPanel
          alert={selected}
          currentUser={currentUser}
          onClose={() => setSelected(null)}
          onUpdated={loadAll}
          onNavigateCase={caseId => { setSelected(null); navigate(`/case/${caseId}`); }}
        />
      )}

      {/* Manual Flag Dialog */}
      <Dialog open={manualFlag} onOpenChange={setManualFlag}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Create Manual Flag</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <label className="text-xs font-medium block mb-1.5">Client *</label>
              <Select value={flagForm.client_id} onValueChange={v => setFlagForm(f => ({ ...f, client_id: v }))}>
                <SelectTrigger className="h-9 text-sm"><SelectValue placeholder="Select client" /></SelectTrigger>
                <SelectContent>
                  {clients.map(c => <SelectItem key={c.id} value={c.id}>{c.full_name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-xs font-medium block mb-1.5">Reason *</label>
              <Textarea
                value={flagForm.reason}
                onChange={e => setFlagForm(f => ({ ...f, reason: e.target.value }))}
                placeholder="Describe why this client is being flagged for review…"
                className="text-sm min-h-20 resize-none"
              />
            </div>
            <div className="flex gap-2 justify-end">
              <Button variant="outline" onClick={() => setManualFlag(false)}>Cancel</Button>
              <Button onClick={createManualFlag} disabled={!flagForm.client_id || !flagForm.reason.trim() || flagging} className="gap-2">
                {flagging && <Loader2 className="w-4 h-4 animate-spin" />}
                Create Flag
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}