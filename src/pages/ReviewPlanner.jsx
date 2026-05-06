import React, { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { useTenant } from '@/lib/tenantContext';
import AppShell from '@/components/layout/AppShell';
import { Calendar, Clock, AlertTriangle, Loader2, ChevronRight } from 'lucide-react';
import { format, addDays, isPast, isWithinInterval } from 'date-fns';
import { cn } from '@/lib/utils';
import { useNavigate } from 'react-router-dom';
import RiskBadge from '@/components/shared/RiskBadge';

export default function ReviewPlanner() {
  const { currentUser } = useTenant();
  const navigate = useNavigate();
  const [clients, setClients] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('upcoming'); // upcoming | overdue | all

  useEffect(() => { loadClients(); }, [currentUser]);

  async function loadClients() {
    if (!currentUser?.tenant_id) return;
    const data = await base44.entities.Client.filter({ tenant_id: currentUser.tenant_id, status: 'Active' }, 'next_review_date', 200);
    setClients(data || []);
    setLoading(false);
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

  const overdueCnt = clients.filter(c => c.next_review_date && isPast(new Date(c.next_review_date))).length;
  const upcomingCnt = clients.filter(c => c.next_review_date && isWithinInterval(new Date(c.next_review_date), { start: now, end: in90days })).length;

  return (
    <AppShell>
      <div className="p-6 max-w-screen-lg mx-auto space-y-5">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold">Review Planner</h1>
            <p className="text-sm text-muted-foreground mt-0.5">Upcoming and overdue periodic reviews</p>
          </div>
        </div>

        {/* KPI row */}
        <div className="grid grid-cols-3 gap-4">
          {[
            { label: 'Overdue', value: overdueCnt, color: 'text-red-600', bg: 'bg-red-50 border-red-200' },
            { label: 'Due in 90 days', value: upcomingCnt, color: 'text-amber-600', bg: 'bg-amber-50 border-amber-200' },
            { label: 'Total Active Clients', value: clients.length, color: 'text-foreground', bg: 'bg-card border-border' },
          ].map(k => (
            <div key={k.label} className={cn('rounded-xl border p-4', k.bg)}>
              <div className={cn('text-2xl font-bold', k.color)}>{k.value}</div>
              <div className="text-xs text-muted-foreground mt-1">{k.label}</div>
            </div>
          ))}
        </div>

        {/* Filter tabs */}
        <div className="flex gap-2">
          {[['upcoming', 'Due in 90 days'], ['overdue', 'Overdue'], ['all', 'All clients']].map(([v, l]) => (
            <button key={v} onClick={() => setFilter(v)}
              className={cn('text-xs font-medium px-3 py-1.5 rounded-lg transition-colors',
                filter === v ? 'bg-primary text-white' : 'bg-muted text-muted-foreground hover:bg-muted/80'
              )}>{l}</button>
          ))}
        </div>

        {/* Table */}
        <div className="bg-card border border-border rounded-xl overflow-hidden">
          {loading ? (
            <div className="flex items-center justify-center py-16"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>
          ) : filtered.length === 0 ? (
            <div className="py-16 text-center text-muted-foreground text-sm">No clients match this filter.</div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-muted/40 border-b border-border text-xs text-muted-foreground uppercase tracking-wide">
                  <th className="text-left px-4 py-3">Client</th>
                  <th className="text-left px-4 py-3">Risk</th>
                  <th className="text-left px-4 py-3">Next Review</th>
                  <th className="text-left px-4 py-3">Status</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {filtered.map(c => {
                  const d = c.next_review_date ? new Date(c.next_review_date) : null;
                  const isOv = d && isPast(d);
                  return (
                    <tr key={c.id} className="hover:bg-muted/20 transition-colors cursor-pointer" onClick={() => navigate(`/client/${c.id}`)}>
                      <td className="px-4 py-3 font-medium">{c.full_name}</td>
                      <td className="px-4 py-3"><RiskBadge risk={c.risk_classification} /></td>
                      <td className="px-4 py-3">
                        {d ? (
                          <span className={cn('font-medium', isOv ? 'text-red-600' : 'text-foreground')}>
                            {format(d, 'd MMM yyyy')}
                          </span>
                        ) : <span className="text-muted-foreground">—</span>}
                      </td>
                      <td className="px-4 py-3">
                        {isOv
                          ? <span className="inline-flex items-center gap-1 text-xs text-red-700 bg-red-50 px-2 py-0.5 rounded-full"><AlertTriangle className="w-3 h-3" /> Overdue</span>
                          : <span className="inline-flex items-center gap-1 text-xs text-amber-700 bg-amber-50 px-2 py-0.5 rounded-full"><Clock className="w-3 h-3" /> Upcoming</span>
                        }
                      </td>
                      <td className="px-4 py-3 text-right"><ChevronRight className="w-4 h-4 text-muted-foreground inline" /></td>
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