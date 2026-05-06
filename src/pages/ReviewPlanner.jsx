import React, { useState, useEffect, useMemo } from 'react';
import { base44 } from '@/api/base44Client';
import { useTenant } from '@/lib/tenantContext';
import AppShell from '@/components/layout/AppShell';
import PageHeader from '@/components/shared/PageHeader';
import RiskBadge from '@/components/shared/RiskBadge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import {
  Calendar, List, AlertTriangle, Clock, Loader2, ChevronRight,
  RefreshCw, Users, ChevronLeft, CheckSquare, Square, Zap
} from 'lucide-react';
import {
  format, addDays, isPast, isWithinInterval, startOfMonth, endOfMonth,
  addMonths, subMonths, differenceInDays, isSameMonth
} from 'date-fns';
import { cn } from '@/lib/utils';
import { useNavigate } from 'react-router-dom';

const RISK_COLORS = {
  Low: 'bg-emerald-100 text-emerald-800 border-emerald-200',
  Medium: 'bg-amber-100 text-amber-800 border-amber-200',
  High: 'bg-red-100 text-red-800 border-red-200',
  Unacceptable: 'bg-rose-200 text-rose-900 border-rose-300',
};
const RISK_DOT = { Low: '#22c55e', Medium: '#f59e0b', High: '#ef4444', Unacceptable: '#881337' };

export default function ReviewPlanner() {
  const { currentUser } = useTenant();
  const navigate = useNavigate();

  const [clients, setClients]   = useState([]);
  const [users, setUsers]       = useState([]);
  const [cases, setCases]       = useState([]);
  const [loading, setLoading]   = useState(true);
  const [viewMode, setViewMode] = useState('list'); // 'list' | 'calendar'
  const [calMonth, setCalMonth] = useState(new Date());

  // Filters
  const [filterAnalyst, setFilterAnalyst] = useState('all');
  const [filterRisk, setFilterRisk]       = useState('all');
  const [filterMonth, setFilterMonth]     = useState('all');
  const [filterStatus, setFilterStatus]   = useState('upcoming'); // 'upcoming'|'overdue'|'all'

  // Bulk selection
  const [selected, setSelected] = useState(new Set());

  // Dialogs
  const [assignDialog, setAssignDialog]   = useState(false);
  const [assignTo, setAssignTo]           = useState('');
  const [extendDialog, setExtendDialog]   = useState(false);
  const [extendDate, setExtendDate]       = useState('');
  const [extendNote, setExtendNote]       = useState('');
  const [bulkWorking, setBulkWorking]     = useState(false);
  const [triggering, setTriggering]       = useState(null);

  useEffect(() => { load(); }, [currentUser]);

  async function load() {
    if (!currentUser?.tenant_id) return;
    setLoading(true);
    const [clientData, usersData, caseData] = await Promise.all([
      base44.entities.Client.filter({ tenant_id: currentUser.tenant_id, status: 'Active' }),
      base44.entities.User.list(),
      base44.entities.KycCase.filter({ tenant_id: currentUser.tenant_id }, '-created_date', 500),
    ]);
    setClients(clientData || []);
    setUsers(usersData || []);
    setCases(caseData || []);
    setLoading(false);
  }

  // ── Computed filtered list ────────────────────────────────────────────────
  const now = new Date();
  const in30  = addDays(now, 30);
  const in90  = addDays(now, 90);

  const filtered = useMemo(() => {
    return clients.filter(c => {
      if (filterAnalyst !== 'all' && c.assigned_analyst_id !== filterAnalyst) return false;
      if (filterRisk !== 'all' && c.risk_classification !== filterRisk) return false;
      if (filterMonth !== 'all') {
        const [y, m] = filterMonth.split('-').map(Number);
        if (!c.next_review_date) return false;
        const d = new Date(c.next_review_date);
        if (d.getFullYear() !== y || d.getMonth() + 1 !== m) return false;
      }
      if (filterStatus === 'overdue') return c.next_review_date && isPast(new Date(c.next_review_date));
      if (filterStatus === 'upcoming') {
        if (!c.next_review_date) return false;
        return isWithinInterval(new Date(c.next_review_date), { start: now, end: in90 });
      }
      return true;
    }).sort((a, b) => (a.next_review_date || '') > (b.next_review_date || '') ? 1 : -1);
  }, [clients, filterAnalyst, filterRisk, filterMonth, filterStatus]);

  // ── Metrics ───────────────────────────────────────────────────────────────
  const overdueCnt  = clients.filter(c => c.next_review_date && isPast(new Date(c.next_review_date))).length;
  const due30Cnt    = clients.filter(c => c.next_review_date && isWithinInterval(new Date(c.next_review_date), { start: now, end: in30 })).length;
  const backlogCnt  = clients.filter(c => {
    if (!c.next_review_date) return false;
    const d = new Date(c.next_review_date);
    return (isPast(d) || isWithinInterval(d, { start: now, end: in30 }));
  }).length;

  // Avg days to complete a review by risk class
  const completedReviews = cases.filter(c => c.case_type === 'Periodic_Review' && c.status === 'Approved' && c.created_date && c.completed_at);
  const avgByRisk = ['Low','Medium','High','Unacceptable'].map(risk => {
    const rCases = completedReviews.filter(c => c.risk_classification === risk);
    if (!rCases.length) return null;
    const avg = Math.round(rCases.reduce((s, c) => s + differenceInDays(new Date(c.completed_at), new Date(c.created_date)), 0) / rCases.length);
    return { risk, avg, count: rCases.length };
  }).filter(Boolean);

  // On-time % (last 12 months)
  const cutoff = addDays(now, -365);
  const recentReviews = completedReviews.filter(c => new Date(c.completed_at) >= cutoff);
  const onTimePct = recentReviews.length
    ? Math.round(recentReviews.filter(c => !c.due_date || new Date(c.completed_at) <= new Date(c.due_date)).length / recentReviews.length * 100)
    : null;

  // ── Month options ─────────────────────────────────────────────────────────
  const monthOptions = useMemo(() => {
    const months = new Set();
    clients.forEach(c => {
      if (c.next_review_date) {
        const d = new Date(c.next_review_date);
        months.add(`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`);
      }
    });
    return Array.from(months).sort();
  }, [clients]);

  // ── Calendar data ─────────────────────────────────────────────────────────
  const calClients = useMemo(() => clients.filter(c => {
    if (!c.next_review_date) return false;
    return isSameMonth(new Date(c.next_review_date), calMonth);
  }), [clients, calMonth]);

  // Build calendar grid (days in month)
  function buildCalGrid() {
    const start = startOfMonth(calMonth);
    const end   = endOfMonth(calMonth);
    const grid = [];
    let d = new Date(start);
    // Pad start to Monday
    const dow = (d.getDay() + 6) % 7;
    for (let i = 0; i < dow; i++) grid.push(null);
    while (d <= end) {
      const day = new Date(d);
      const dayClients = calClients.filter(c => {
        const rd = new Date(c.next_review_date);
        return rd.getDate() === day.getDate();
      });
      grid.push({ date: day, clients: dayClients });
      d = addDays(d, 1);
    }
    return grid;
  }

  // ── Select helpers ────────────────────────────────────────────────────────
  function toggleSelect(id) {
    setSelected(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }
  function toggleAll() {
    if (selected.size === filtered.length) setSelected(new Set());
    else setSelected(new Set(filtered.map(c => c.id)));
  }

  // ── Trigger single review ─────────────────────────────────────────────────
  async function triggerReview(client) {
    setTriggering(client.id);
    const dueDate = format(addDays(now, 30), 'yyyy-MM-dd');
    const prevCases = await base44.entities.KycCase.filter({ client_id: client.id, status: 'Approved' }, '-created_date', 1);
    const prev = prevCases?.[0];
    const newCase = await base44.entities.KycCase.create({
      tenant_id: currentUser.tenant_id,
      client_id: client.id,
      case_type: 'Periodic_Review',
      status: 'Draft',
      assigned_analyst_id: prev?.assigned_analyst_id || client.assigned_analyst_id || currentUser.id,
      trigger_reason: `Periodic review triggered. Previous: ${client.last_review_date || 'N/A'}`,
      due_date: dueDate,
      created_by_user_id: currentUser.id,
      previous_case_id: prev?.id || null,
      risk_classification: prev?.risk_classification || client.risk_classification || null,
    });
    await base44.entities.AuditEvent.create({
      tenant_id: currentUser.tenant_id, case_id: newCase.id,
      actor_user_id: currentUser.id, actor_name: currentUser.full_name, actor_type: 'User',
      event_type: 'periodic_review_created', notes: `Periodic review created for ${client.full_name}`,
    });
    const analystId = prev?.assigned_analyst_id || client.assigned_analyst_id;
    if (analystId && analystId !== currentUser.id) {
      await base44.entities.Notification.create({
        tenant_id: currentUser.tenant_id, user_id: analystId, type: 'periodic_review_created',
        title: 'Periodic Review Due',
        body: `Periodic review for ${client.full_name} due. Case created.`,
        link_case_id: newCase.id, link_client_id: client.id,
      });
    }
    setTriggering(null);
    navigate(`/case/${newCase.id}`);
  }

  // ── Bulk: Assign Analyst ──────────────────────────────────────────────────
  async function bulkAssign() {
    if (!assignTo) return;
    setBulkWorking(true);
    for (const clientId of selected) {
      await base44.entities.Client.update(clientId, { assigned_analyst_id: assignTo });
      await base44.entities.AuditEvent.create({
        tenant_id: currentUser.tenant_id, client_id: clientId,
        actor_user_id: currentUser.id, actor_name: currentUser.full_name, actor_type: 'User',
        event_type: 'analyst_assigned',
        notes: `Bulk analyst assignment: ${users.find(u=>u.id===assignTo)?.full_name}`,
      });
    }
    setBulkWorking(false);
    setAssignDialog(false);
    setSelected(new Set());
    load();
  }

  // ── Bulk: Extend Review Date ──────────────────────────────────────────────
  async function bulkExtend() {
    if (!extendDate || extendNote.length < 10) return;
    setBulkWorking(true);
    for (const clientId of selected) {
      await base44.entities.Client.update(clientId, { next_review_date: extendDate });
      await base44.entities.AuditEvent.create({
        tenant_id: currentUser.tenant_id, client_id: clientId,
        actor_user_id: currentUser.id, actor_name: currentUser.full_name, actor_type: 'User',
        event_type: 'review_date_extended', is_override: true,
        notes: `Review date extended to ${extendDate}. Justification: ${extendNote}`,
      });
    }
    setBulkWorking(false);
    setExtendDialog(false);
    setSelected(new Set());
    setExtendDate('');
    setExtendNote('');
    load();
  }

  // ── Auto-assign ───────────────────────────────────────────────────────────
  async function autoAssign() {
    const analysts = users.filter(u => u.app_role === 'Analyst' || u.app_role === 'QC Reviewer');
    if (!analysts.length) return;
    setBulkWorking(true);
    // Count current open cases per analyst
    const openCases = cases.filter(c => !['Approved','Closed','Rejected'].includes(c.status));
    const load_map = {};
    analysts.forEach(a => { load_map[a.id] = openCases.filter(c => c.assigned_analyst_id === a.id).length; });
    // Distribute selected clients to analyst with lowest load
    for (const clientId of (selected.size > 0 ? selected : new Set(filtered.map(c => c.id)))) {
      const analystId = Object.entries(load_map).sort((a,b) => a[1]-b[1])[0][0];
      await base44.entities.Client.update(clientId, { assigned_analyst_id: analystId });
      await base44.entities.AuditEvent.create({
        tenant_id: currentUser.tenant_id, client_id: clientId,
        actor_user_id: currentUser.id, actor_name: currentUser.full_name, actor_type: 'User',
        event_type: 'analyst_auto_assigned',
        notes: `Auto-assigned to ${users.find(u=>u.id===analystId)?.full_name} (lowest case load)`,
      });
      load_map[analystId]++;
    }
    setBulkWorking(false);
    setSelected(new Set());
    load();
  }

  const tenantUsers = users.filter(u => u.tenant_id === currentUser?.tenant_id);
  const calGrid = viewMode === 'calendar' ? buildCalGrid() : [];

  return (
    <AppShell>
      <div className="p-6 max-w-screen-xl mx-auto space-y-5">
        <PageHeader
          title="Review Planner"
          subtitle="Plan and manage upcoming periodic reviews across the portfolio"
          actions={
            <div className="flex gap-2">
              <Button size="sm" variant={viewMode==='list'?'default':'outline'} className="gap-1.5 text-xs" onClick={() => setViewMode('list')}>
                <List className="w-3.5 h-3.5" /> List
              </Button>
              <Button size="sm" variant={viewMode==='calendar'?'default':'outline'} className="gap-1.5 text-xs" onClick={() => setViewMode('calendar')}>
                <Calendar className="w-3.5 h-3.5" /> Calendar
              </Button>
              <Button size="sm" variant="outline" className="gap-1.5 text-xs" onClick={load}>
                <RefreshCw className="w-3.5 h-3.5" /> Refresh
              </Button>
            </div>
          }
        />

        {/* ── KPI row ── */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          {[
            { label: 'Overdue', value: overdueCnt, color: 'text-red-600', bg: 'bg-red-50 border-red-200' },
            { label: 'Due in 30 days', value: due30Cnt, color: 'text-amber-600', bg: 'bg-amber-50 border-amber-200' },
            { label: 'Backlog', value: backlogCnt, color: 'text-orange-600', bg: 'bg-orange-50 border-orange-200' },
            { label: 'On-Time Rate (12m)', value: onTimePct !== null ? `${onTimePct}%` : '—', color: 'text-emerald-600', bg: 'bg-emerald-50 border-emerald-200' },
            { label: 'Active Clients', value: clients.length, color: 'text-foreground', bg: 'bg-card border-border' },
          ].map(k => (
            <div key={k.label} className={cn('rounded-xl border p-3', k.bg)}>
              <div className={cn('text-2xl font-bold tabular-nums', k.color)}>{loading ? '…' : k.value}</div>
              <div className="text-xs text-muted-foreground mt-0.5">{k.label}</div>
            </div>
          ))}
        </div>

        {/* ── Avg days by risk class ── */}
        {avgByRisk.length > 0 && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {avgByRisk.map(r => (
              <div key={r.risk} className={cn('rounded-lg border px-3 py-2.5', RISK_COLORS[r.risk])}>
                <div className="text-lg font-bold tabular-nums">{r.avg}d</div>
                <div className="text-xs mt-0.5">{r.risk} — avg review time ({r.count} completed)</div>
              </div>
            ))}
          </div>
        )}

        {/* ── Filters row ── */}
        <div className="flex flex-wrap gap-3 items-center">
          <div className="flex gap-1 bg-muted/40 rounded-lg p-1 border border-border">
            {[['upcoming','Due in 90d'],['overdue','Overdue'],['all','All']].map(([v,l]) => (
              <button key={v} onClick={() => setFilterStatus(v)}
                className={cn('text-xs font-medium px-3 py-1.5 rounded-md transition-colors',
                  filterStatus===v ? 'bg-card shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground')}>
                {l}
              </button>
            ))}
          </div>
          <Select value={filterAnalyst} onValueChange={setFilterAnalyst}>
            <SelectTrigger className="h-8 text-xs w-44"><SelectValue placeholder="All Analysts" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Analysts</SelectItem>
              {tenantUsers.map(u => <SelectItem key={u.id} value={u.id}>{u.full_name}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={filterRisk} onValueChange={setFilterRisk}>
            <SelectTrigger className="h-8 text-xs w-36"><SelectValue placeholder="All Risk" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Risk Classes</SelectItem>
              {['Low','Medium','High','Unacceptable'].map(r => <SelectItem key={r} value={r}>{r}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={filterMonth} onValueChange={setFilterMonth}>
            <SelectTrigger className="h-8 text-xs w-36"><SelectValue placeholder="All Months" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Months</SelectItem>
              {monthOptions.map(m => <SelectItem key={m} value={m}>{format(new Date(m+'-01'),'MMM yyyy')}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>

        {/* ── Bulk actions bar ── */}
        {selected.size > 0 && (
          <div className="flex items-center gap-3 bg-primary/5 border border-primary/20 rounded-xl px-4 py-2.5">
            <span className="text-xs font-semibold text-primary">{selected.size} selected</span>
            <div className="flex gap-2 ml-auto">
              <Button size="sm" variant="outline" className="text-xs gap-1 h-7" onClick={() => setAssignDialog(true)}>
                <Users className="w-3 h-3" /> Assign Analyst
              </Button>
              <Button size="sm" variant="outline" className="text-xs gap-1 h-7" onClick={() => setExtendDialog(true)}>
                <Calendar className="w-3 h-3" /> Extend Date
              </Button>
              <Button size="sm" variant="ghost" className="text-xs h-7" onClick={() => setSelected(new Set())}>
                Clear
              </Button>
            </div>
          </div>
        )}

        {/* Auto-assign button */}
        <div className="flex justify-end">
          <Button size="sm" variant="outline" className="text-xs gap-1.5" onClick={autoAssign} disabled={bulkWorking}>
            {bulkWorking ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Zap className="w-3.5 h-3.5" />}
            Auto-assign Reviews
          </Button>
        </div>

        {/* ── Calendar View ── */}
        {viewMode === 'calendar' && (
          <div className="bg-card border border-border rounded-xl overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b border-border">
              <button onClick={() => setCalMonth(m => subMonths(m, 1))} className="p-1 hover:bg-muted rounded-md transition-colors">
                <ChevronLeft className="w-4 h-4" />
              </button>
              <span className="font-semibold text-sm">{format(calMonth, 'MMMM yyyy')}</span>
              <button onClick={() => setCalMonth(m => addMonths(m, 1))} className="p-1 hover:bg-muted rounded-md transition-colors">
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
            <div className="grid grid-cols-7 border-b border-border">
              {['Mon','Tue','Wed','Thu','Fri','Sat','Sun'].map(d => (
                <div key={d} className="text-center text-xs text-muted-foreground py-2 font-medium">{d}</div>
              ))}
            </div>
            <div className="grid grid-cols-7">
              {calGrid.map((cell, i) => (
                <div key={i} className={cn(
                  'min-h-[80px] border-b border-r border-border p-1.5',
                  !cell && 'bg-muted/20',
                  cell?.clients.length > 0 && 'bg-blue-50/40'
                )}>
                  {cell && (
                    <>
                      <div className="text-xs text-muted-foreground mb-1">{cell.date.getDate()}</div>
                      {cell.clients.slice(0,3).map(c => (
                        <div key={c.id}
                          className="text-xs px-1.5 py-0.5 rounded mb-0.5 truncate cursor-pointer hover:opacity-80"
                          style={{ backgroundColor: RISK_DOT[c.risk_classification] + '20', color: RISK_DOT[c.risk_classification], borderLeft: `3px solid ${RISK_DOT[c.risk_classification]}` }}
                          onClick={() => navigate(`/client/${c.id}`)}>
                          {c.full_name}
                        </div>
                      ))}
                      {cell.clients.length > 3 && (
                        <div className="text-xs text-muted-foreground pl-1">+{cell.clients.length-3} more</div>
                      )}
                    </>
                  )}
                </div>
              ))}
            </div>
            <div className="px-4 py-2.5 border-t border-border flex items-center gap-4 bg-muted/20">
              <span className="text-xs text-muted-foreground font-medium">Risk key:</span>
              {Object.entries(RISK_DOT).map(([r, c]) => (
                <div key={r} className="flex items-center gap-1">
                  <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: c }} />
                  <span className="text-xs text-muted-foreground">{r}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── List View ── */}
        {viewMode === 'list' && (
          <div className="bg-card border border-border rounded-xl overflow-hidden">
            {loading ? (
              <div className="flex items-center justify-center py-16"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>
            ) : filtered.length === 0 ? (
              <div className="py-16 text-center text-muted-foreground text-sm">No clients match this filter.</div>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-muted/40 border-b border-border text-xs text-muted-foreground uppercase tracking-wide">
                    <th className="px-4 py-3 w-8">
                      <button onClick={toggleAll}>
                        {selected.size === filtered.length && filtered.length > 0
                          ? <CheckSquare className="w-4 h-4 text-primary" />
                          : <Square className="w-4 h-4" />}
                      </button>
                    </th>
                    <th className="text-left px-4 py-3">Client</th>
                    <th className="text-left px-4 py-3">Risk</th>
                    <th className="text-left px-4 py-3">Assigned Analyst</th>
                    <th className="text-left px-4 py-3">Next Review</th>
                    <th className="text-left px-4 py-3">Days Until Due</th>
                    <th className="text-left px-4 py-3">Case Status</th>
                    <th className="px-4 py-3" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {filtered.map(c => {
                    const d = c.next_review_date ? new Date(c.next_review_date) : null;
                    const isOv = d && isPast(d);
                    const daysUntil = d ? differenceInDays(d, now) : null;
                    const analyst = tenantUsers.find(u => u.id === c.assigned_analyst_id);
                    const activeCases = cases.filter(kc => kc.client_id === c.id && !['Approved','Closed','Rejected'].includes(kc.status));
                    const latestCase = activeCases[0];
                    return (
                      <tr key={c.id} className={cn('hover:bg-muted/20 transition-colors', isOv && 'bg-red-50/20', selected.has(c.id) && 'bg-primary/5')}>
                        <td className="px-4 py-3">
                          <button onClick={() => toggleSelect(c.id)}>
                            {selected.has(c.id) ? <CheckSquare className="w-4 h-4 text-primary" /> : <Square className="w-4 h-4 text-muted-foreground" />}
                          </button>
                        </td>
                        <td className="px-4 py-3">
                          <button className="font-medium text-xs hover:text-primary" onClick={() => navigate(`/client/${c.id}`)}>
                            {c.full_name}
                          </button>
                          <div className="text-xs text-muted-foreground">{c.client_type}</div>
                        </td>
                        <td className="px-4 py-3"><RiskBadge risk={c.risk_classification} /></td>
                        <td className="px-4 py-3 text-xs text-muted-foreground">{analyst?.full_name || '—'}</td>
                        <td className="px-4 py-3">
                          {d ? (
                            <span className={cn('text-xs font-medium', isOv ? 'text-red-600' : 'text-foreground')}>
                              {format(d, 'd MMM yyyy')}
                            </span>
                          ) : <span className="text-muted-foreground text-xs">—</span>}
                        </td>
                        <td className="px-4 py-3">
                          {daysUntil !== null ? (
                            <span className={cn('text-xs font-semibold tabular-nums',
                              daysUntil < 0 ? 'text-red-600' : daysUntil <= 30 ? 'text-amber-600' : 'text-muted-foreground')}>
                              {daysUntil < 0 ? `${Math.abs(daysUntil)}d overdue` : `${daysUntil}d`}
                            </span>
                          ) : <span className="text-xs text-muted-foreground">—</span>}
                        </td>
                        <td className="px-4 py-3">
                          {latestCase ? (
                            <span className="text-xs bg-blue-50 text-blue-700 border border-blue-200 px-2 py-0.5 rounded-full">
                              {latestCase.status?.replace(/_/g,' ')}
                            </span>
                          ) : (
                            isOv
                              ? <span className="inline-flex items-center gap-1 text-xs text-red-700 bg-red-50 px-2 py-0.5 rounded-full border border-red-200"><AlertTriangle className="w-3 h-3" /> Overdue</span>
                              : <span className="inline-flex items-center gap-1 text-xs text-amber-700 bg-amber-50 px-2 py-0.5 rounded-full border border-amber-200"><Clock className="w-3 h-3" /> No open case</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <Button size="sm" variant="outline" className="text-xs gap-1 h-7"
                            disabled={triggering === c.id} onClick={() => triggerReview(c)}>
                            {triggering === c.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <ChevronRight className="w-3 h-3" />}
                            Trigger
                          </Button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        )}
      </div>

      {/* ── Assign Dialog ── */}
      <Dialog open={assignDialog} onOpenChange={setAssignDialog}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Assign Analyst — {selected.size} clients</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <Select value={assignTo} onValueChange={setAssignTo}>
              <SelectTrigger className="h-9 text-sm"><SelectValue placeholder="Choose analyst" /></SelectTrigger>
              <SelectContent>
                {tenantUsers.map(u => <SelectItem key={u.id} value={u.id}>{u.full_name} ({u.app_role})</SelectItem>)}
              </SelectContent>
            </Select>
            <div className="flex gap-2 justify-end">
              <Button variant="outline" onClick={() => setAssignDialog(false)}>Cancel</Button>
              <Button disabled={!assignTo || bulkWorking} onClick={bulkAssign} className="gap-2">
                {bulkWorking && <Loader2 className="w-4 h-4 animate-spin" />} Assign
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Extend Date Dialog ── */}
      <Dialog open={extendDialog} onOpenChange={setExtendDialog}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Extend Review Date — {selected.size} clients</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <label className="text-xs font-medium block mb-1.5">New Review Date *</label>
              <Input type="date" value={extendDate} onChange={e => setExtendDate(e.target.value)} className="h-9 text-sm" />
            </div>
            <div>
              <label className="text-xs font-medium block mb-1.5">Justification * (min 10 chars)</label>
              <Textarea value={extendNote} onChange={e => setExtendNote(e.target.value)}
                placeholder="Reason for extending review date…" className="text-sm min-h-16 resize-none" />
            </div>
            <div className="flex gap-2 justify-end">
              <Button variant="outline" onClick={() => setExtendDialog(false)}>Cancel</Button>
              <Button disabled={!extendDate || extendNote.length < 10 || bulkWorking} onClick={bulkExtend} className="gap-2">
                {bulkWorking && <Loader2 className="w-4 h-4 animate-spin" />} Extend
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}