import React, { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { useTenant } from '@/lib/tenantContext';
import AppShell from '@/components/layout/AppShell';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Calendar, Clock, AlertTriangle, Loader2, ChevronRight, RefreshCw } from 'lucide-react';
import { format, addDays, isPast, isWithinInterval } from 'date-fns';
import { cn } from '@/lib/utils';
import { useNavigate } from 'react-router-dom';
import RiskBadge from '@/components/shared/RiskBadge';

export default function ReviewPlanner() {
  const { currentUser } = useTenant();
  const navigate = useNavigate();
  const [clients, setClients]   = useState([]);
  const [users, setUsers]       = useState([]);
  const [loading, setLoading]   = useState(true);
  const [filter, setFilter]     = useState('upcoming');
  const [triggering, setTriggering] = useState(null);

  useEffect(() => { loadClients(); }, [currentUser]);

  async function loadClients() {
    if (!currentUser?.tenant_id) return;
    const [clientData, usersData] = await Promise.all([
      base44.entities.Client.filter({ tenant_id: currentUser.tenant_id, status: 'Active' }, 'next_review_date', 200),
      base44.entities.User.list(),
    ]);
    setClients(clientData || []);
    setUsers(usersData || []);
    setLoading(false);
  }

  async function triggerPeriodicReview(client) {
    setTriggering(client.id);
    const dueDate = format(addDays(new Date(), 30), 'yyyy-MM-dd');

    // Find last approved case
    const prevCases = await base44.entities.KycCase.filter(
      { client_id: client.id, status: 'Approved' },
      '-created_date',
      1
    );
    const prevCase = prevCases?.[0];

    const newCase = await base44.entities.KycCase.create({
      tenant_id: currentUser.tenant_id,
      client_id: client.id,
      case_type: 'Periodic_Review',
      status: 'Draft',
      assigned_analyst_id: prevCase?.assigned_analyst_id || client.assigned_analyst_id || currentUser.id,
      trigger_reason: `Periodic review triggered manually. Previous review: ${client.last_review_date || 'N/A'}`,
      due_date: dueDate,
      created_by_user_id: currentUser.id,
      previous_case_id: prevCase?.id || null,
      risk_classification: prevCase?.risk_classification || client.risk_classification || null,
      step_1_status: 'not_started', step_2_status: 'not_started', step_3_status: 'not_started',
      step_4_status: 'not_started', step_5_status: 'not_started', step_6_status: 'not_started',
      step_7_status: 'not_started', step_8_status: 'not_started',
    });

    await base44.entities.AuditEvent.create({
      tenant_id: currentUser.tenant_id,
      case_id: newCase.id,
      actor_user_id: currentUser.id,
      actor_name: currentUser.full_name,
      actor_type: 'User',
      event_type: 'periodic_review_created',
      notes: `Periodic review case created for ${client.full_name}`,
    });

    // Notify assigned analyst
    const analystId = prevCase?.assigned_analyst_id || client.assigned_analyst_id;
    if (analystId && analystId !== currentUser.id) {
      await base44.entities.Notification.create({
        tenant_id: currentUser.tenant_id,
        user_id: analystId,
        type: 'periodic_review_created',
        title: 'Periodic Review Due',
        body: `Periodic review for ${client.full_name} is due. Case created — please action within 30 days.`,
        link_case_id: newCase.id,
        link_client_id: client.id,
      });
    }

    setTriggering(null);
    navigate(`/case/${newCase.id}`);
  }

  const now = new Date();
  const in90days = addDays(now, 90);

  const filtered = clients.filter(c => {
    if (!c.next_review_date) return filter === 'all';
    const d = new Date(c.next_review_date);
    if (filter === 'overdue') return isPast(d);
    if (filter === 'upcoming') return isWithinInterval(d, { start: now, end: in90days });
    return true;
  }).sort((a, b) => (a.next_review_date || '') > (b.next_review_date || '') ? 1 : -1);

  const overdueCnt  = clients.filter(c => c.next_review_date && isPast(new Date(c.next_review_date))).length;
  const upcomingCnt = clients.filter(c => c.next_review_date && isWithinInterval(new Date(c.next_review_date), { start: now, end: in90days })).length;

  return (
    <AppShell>
      <div className="p-6 max-w-screen-lg mx-auto space-y-5">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold">Review Planner</h1>
            <p className="text-sm text-muted-foreground mt-0.5">Upcoming and overdue periodic reviews</p>
          </div>
          <Button size="sm" variant="outline" className="gap-1.5 text-xs" onClick={loadClients}>
            <RefreshCw className="w-3.5 h-3.5" /> Refresh
          </Button>
        </div>

        {/* KPI row */}
        <div className="grid grid-cols-3 gap-4">
          {[
            { label: 'Overdue',            value: overdueCnt,       color: 'text-red-600',   bg: 'bg-red-50 border-red-200' },
            { label: 'Due in 90 days',     value: upcomingCnt,      color: 'text-amber-600', bg: 'bg-amber-50 border-amber-200' },
            { label: 'Total Active Clients', value: clients.length, color: 'text-foreground', bg: 'bg-card border-border' },
          ].map(k => (
            <div key={k.label} className={cn('rounded-xl border p-4', k.bg)}>
              <div className={cn('text-2xl font-bold', k.color)}>{loading ? '…' : k.value}</div>
              <div className="text-xs text-muted-foreground mt-1">{k.label}</div>
            </div>
          ))}
        </div>

        {/* Filter tabs */}
        <div className="flex gap-2">
          {[['upcoming','Due in 90 days'], ['overdue','Overdue'], ['all','All clients']].map(([v, l]) => (
            <button key={v} onClick={() => setFilter(v)}
              className={cn('text-xs font-medium px-3 py-1.5 rounded-lg transition-colors',
                filter === v ? 'bg-primary text-white' : 'bg-muted text-muted-foreground hover:bg-muted/80'
              )}>{l}
            </button>
          ))}
        </div>

        {/* Table */}
        <div className="bg-card border border-border rounded-xl overflow-hidden">
          {loading ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
            </div>
          ) : filtered.length === 0 ? (
            <div className="py-16 text-center text-muted-foreground text-sm">No clients match this filter.</div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-muted/40 border-b border-border text-xs text-muted-foreground uppercase tracking-wide">
                  <th className="text-left px-4 py-3">Client</th>
                  <th className="text-left px-4 py-3">Risk</th>
                  <th className="text-left px-4 py-3">Assigned Analyst</th>
                  <th className="text-left px-4 py-3">Next Review</th>
                  <th className="text-left px-4 py-3">Status</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {filtered.map(c => {
                  const d = c.next_review_date ? new Date(c.next_review_date) : null;
                  const isOv = d && isPast(d);
                  const analyst = users.find(u => u.id === c.assigned_analyst_id);
                  return (
                    <tr key={c.id} className={cn('hover:bg-muted/20 transition-colors', isOv && 'bg-red-50/20')}>
                      <td className="px-4 py-3">
                        <button className="font-medium text-xs hover:text-primary transition-colors" onClick={() => navigate(`/client/${c.id}`)}>
                          {c.full_name}
                        </button>
                        <div className="text-xs text-muted-foreground">{c.client_type}</div>
                      </td>
                      <td className="px-4 py-3"><RiskBadge risk={c.risk_classification} /></td>
                      <td className="px-4 py-3 text-xs text-muted-foreground">{analyst?.full_name || '—'}</td>
                      <td className="px-4 py-3">
                        {d ? (
                          <span className={cn('font-medium text-xs', isOv ? 'text-red-600' : 'text-foreground')}>
                            {format(d, 'd MMM yyyy')}
                          </span>
                        ) : <span className="text-muted-foreground text-xs">—</span>}
                      </td>
                      <td className="px-4 py-3">
                        {isOv
                          ? <span className="inline-flex items-center gap-1 text-xs text-red-700 bg-red-50 px-2 py-0.5 rounded-full border border-red-200"><AlertTriangle className="w-3 h-3" /> Overdue</span>
                          : <span className="inline-flex items-center gap-1 text-xs text-amber-700 bg-amber-50 px-2 py-0.5 rounded-full border border-amber-200"><Clock className="w-3 h-3" /> Upcoming</span>
                        }
                      </td>
                      <td className="px-4 py-3 text-right">
                        <Button
                          size="sm" variant="outline"
                          className="text-xs gap-1 h-7"
                          disabled={triggering === c.id}
                          onClick={() => triggerPeriodicReview(c)}
                        >
                          {triggering === c.id
                            ? <Loader2 className="w-3 h-3 animate-spin" />
                            : <ChevronRight className="w-3 h-3" />
                          }
                          Trigger Review
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </AppShell>
  );
}