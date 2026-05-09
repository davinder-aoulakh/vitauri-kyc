import React, { useState, useEffect, useMemo } from 'react';
import { base44 } from '@/api/base44Client';
import { useTenant } from '@/lib/tenantContext';
import AppShell from '@/components/layout/AppShell';
import PageHeader from '@/components/shared/PageHeader';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Download, Loader2, Search, RefreshCw, Filter, X } from 'lucide-react';
import { format, isWithinInterval } from 'date-fns';
import { cn } from '@/lib/utils';

const EVENT_TYPES = [
  'case_created','case_status_changed','case_assigned','case_note_updated',
  'document_uploaded','document_reviewed',
  'client_created','client_updated',
  'risk_override','sign_off_submitted','sign_off_approved','sign_off_rejected',
  'screening_run','screening_hit_resolved',
  'outreach_sent','portal_viewed','portal_submitted',
  'control_measure_created','control_measure_updated',
  'monitoring_alert_escalated','monitoring_alert_dismissed',
  'audit_log_export',
];

const ACTOR_TYPE_COLORS = {
  User:     'bg-blue-50 text-blue-700 border-blue-200',
  AI_Agent: 'bg-purple-50 text-purple-700 border-purple-200',
  System:   'bg-slate-50 text-slate-600 border-slate-200',
};

function exportCSV(rows, filename) {
  if (!rows.length) return;
  const cols = ['created_date','actor_name','actor_type','event_type','case_id','client_id','notes','is_override'];
  const header = cols.join(',');
  const body = rows.map(r =>
    cols.map(c => `"${String(r[c] ?? '').replace(/"/g, '""')}"`).join(',')
  ).join('\n');
  const blob = new Blob([header + '\n' + body], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

export default function AuditLogs() {
  const { currentUser } = useTenant();

  const [events, setEvents]   = useState([]);
  const [users, setUsers]     = useState([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(null);

  // Filters
  const [fromDate, setFromDate]     = useState('');
  const [toDate, setToDate]         = useState('');
  const [actorFilter, setActorFilter] = useState('all');
  const [eventTypeFilter, setEventTypeFilter] = useState('all');
  const [entitySearch, setEntitySearch] = useState('');
  const [notesSearch, setNotesSearch]   = useState('');
  const [sortCol, setSortCol]   = useState('created_date');
  const [sortDir, setSortDir]   = useState('desc');
  const [page, setPage]         = useState(1);
  const PAGE_SIZE = 50;

  useEffect(() => { if (currentUser?.tenant_id) load(); }, [currentUser]);

  async function load() {
    setLoading(true);
    try {
      const [evData, usersData] = await Promise.all([
        base44.entities.AuditEvent.filter({ tenant_id: currentUser.tenant_id }, '-created_date', 2000),
        base44.entities.User.list().catch(() => []),
      ]);
      setEvents(evData || []);
      setUsers(usersData || []);
    } finally {
      setLoading(false);
    }
  }

  const tenantUsers = users.filter(u => u.tenant_id === currentUser?.tenant_id);

  const filtered = useMemo(() => {
    let list = [...events];

    if (fromDate) {
      const from = new Date(fromDate);
      list = list.filter(e => e.created_date && new Date(e.created_date) >= from);
    }
    if (toDate) {
      const to = new Date(toDate); to.setHours(23,59,59);
      list = list.filter(e => e.created_date && new Date(e.created_date) <= to);
    }
    if (actorFilter !== 'all') list = list.filter(e => e.actor_user_id === actorFilter);
    if (eventTypeFilter !== 'all') list = list.filter(e => e.event_type === eventTypeFilter);
    if (entitySearch.trim()) {
      const q = entitySearch.trim().toLowerCase();
      list = list.filter(e => e.case_id?.toLowerCase().includes(q) || e.client_id?.toLowerCase().includes(q));
    }
    if (notesSearch.trim()) {
      const q = notesSearch.trim().toLowerCase();
      list = list.filter(e => e.notes?.toLowerCase().includes(q) || e.actor_name?.toLowerCase().includes(q));
    }

    // Sort
    list.sort((a, b) => {
      let va = a[sortCol] ?? '';
      let vb = b[sortCol] ?? '';
      if (sortCol === 'created_date') { va = new Date(va); vb = new Date(vb); }
      if (va < vb) return sortDir === 'asc' ? -1 : 1;
      if (va > vb) return sortDir === 'asc' ? 1 : -1;
      return 0;
    });

    return list;
  }, [events, fromDate, toDate, actorFilter, eventTypeFilter, entitySearch, notesSearch, sortCol, sortDir]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pageRows   = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  function toggleSort(col) {
    if (sortCol === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortCol(col); setSortDir('desc'); }
    setPage(1);
  }

  function clearFilters() {
    setFromDate(''); setToDate(''); setActorFilter('all');
    setEventTypeFilter('all'); setEntitySearch(''); setNotesSearch('');
    setPage(1);
  }

  const hasFilters = fromDate || toDate || actorFilter !== 'all' || eventTypeFilter !== 'all' || entitySearch || notesSearch;

  function SortTh({ col, label }) {
    const active = sortCol === col;
    return (
      <th className="text-left px-3 py-2.5 cursor-pointer select-none hover:bg-muted/60 transition-colors" onClick={() => toggleSort(col)}>
        <div className="flex items-center gap-1">
          <span>{label}</span>
          <span className={cn('text-xs', active ? 'text-primary' : 'text-transparent')}>{sortDir === 'asc' ? '↑' : '↓'}</span>
        </div>
      </th>
    );
  }

  return (
    <AppShell>
      <div className="p-6 max-w-screen-2xl mx-auto space-y-5">
        <PageHeader
          title="Audit Log"
          subtitle={`${filtered.length.toLocaleString()} events${hasFilters ? ' (filtered)' : ''} · Full immutable audit trail`}
          actions={
            <div className="flex gap-2">
              <Button size="sm" variant="outline" className="gap-1.5 text-xs" onClick={load} disabled={loading}>
                <RefreshCw className={cn('w-3.5 h-3.5', loading && 'animate-spin')} /> Refresh
              </Button>
              <Button size="sm" variant="outline" className="gap-1.5 text-xs" onClick={() => {
                exportCSV(filtered, `audit-log-${format(new Date(),'yyyyMMdd')}.csv`);
                // log the export itself
                base44.entities.AuditEvent.create({
                  tenant_id: currentUser.tenant_id, actor_user_id: currentUser.id,
                  actor_name: currentUser.full_name, actor_type: 'User',
                  event_type: 'audit_log_export',
                  notes: `Exported ${filtered.length} records with filters: ${JSON.stringify({fromDate,toDate,actorFilter,eventTypeFilter})}`,
                });
              }} disabled={!filtered.length}>
                <Download className="w-3.5 h-3.5" /> Export CSV
              </Button>
            </div>
          }
        />

        {/* Filter bar */}
        <div className="bg-card border border-border rounded-xl p-4">
          <div className="flex items-center gap-1.5 mb-3">
            <Filter className="w-3.5 h-3.5 text-muted-foreground" />
            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Filters</span>
            {hasFilters && (
              <button onClick={clearFilters} className="ml-auto flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors">
                <X className="w-3 h-3" /> Clear all
              </button>
            )}
          </div>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
            <div>
              <label className="text-xs text-muted-foreground block mb-1">From</label>
              <Input type="date" value={fromDate} onChange={e => { setFromDate(e.target.value); setPage(1); }} className="h-8 text-xs" />
            </div>
            <div>
              <label className="text-xs text-muted-foreground block mb-1">To</label>
              <Input type="date" value={toDate} onChange={e => { setToDate(e.target.value); setPage(1); }} className="h-8 text-xs" />
            </div>
            <div>
              <label className="text-xs text-muted-foreground block mb-1">Actor</label>
              <Select value={actorFilter} onValueChange={v => { setActorFilter(v); setPage(1); }}>
                <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="All users" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Users</SelectItem>
                  {tenantUsers.map(u => <SelectItem key={u.id} value={u.id}>{u.full_name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-xs text-muted-foreground block mb-1">Event Type</label>
              <Select value={eventTypeFilter} onValueChange={v => { setEventTypeFilter(v); setPage(1); }}>
                <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="All events" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Events</SelectItem>
                  {EVENT_TYPES.map(t => <SelectItem key={t} value={t}>{t.replace(/_/g,' ')}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-xs text-muted-foreground block mb-1">Case / Client ID</label>
              <div className="relative">
                <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-muted-foreground" />
                <Input value={entitySearch} onChange={e => { setEntitySearch(e.target.value); setPage(1); }} className="h-8 text-xs pl-6" placeholder="Search ID…" />
              </div>
            </div>
            <div>
              <label className="text-xs text-muted-foreground block mb-1">Search Notes</label>
              <div className="relative">
                <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-muted-foreground" />
                <Input value={notesSearch} onChange={e => { setNotesSearch(e.target.value); setPage(1); }} className="h-8 text-xs pl-6" placeholder="Keyword…" />
              </div>
            </div>
          </div>
        </div>

        {/* Table */}
        <div className="bg-card border border-border rounded-xl overflow-hidden">
          {loading ? (
            <div className="flex items-center justify-center py-16"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>
          ) : filtered.length === 0 ? (
            <div className="text-center text-muted-foreground text-sm py-16">No audit events match the current filters.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-muted/40 border-b border-border text-muted-foreground uppercase tracking-wide">
                    <SortTh col="created_date" label="Timestamp" />
                    <SortTh col="actor_name"   label="Actor" />
                    <SortTh col="event_type"   label="Event" />
                    <th className="text-left px-3 py-2.5">Case / Client</th>
                    <th className="text-left px-3 py-2.5">Notes</th>
                    <th className="text-left px-3 py-2.5">Override</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {pageRows.map(ev => {
                    const isExp = expanded === ev.id;
                    return (
                      <React.Fragment key={ev.id}>
                        <tr
                          className={cn('hover:bg-muted/20 transition-colors cursor-pointer', ev.is_override && 'bg-amber-50/40')}
                          onClick={() => setExpanded(isExp ? null : ev.id)}
                        >
                          <td className="px-3 py-2.5 font-mono text-muted-foreground whitespace-nowrap">
                            {ev.created_date ? format(new Date(ev.created_date), 'dd MMM yy HH:mm') : '—'}
                          </td>
                          <td className="px-3 py-2.5">
                            <div className="font-medium text-foreground">{ev.actor_name || '—'}</div>
                            <span className={cn('text-xs px-1.5 py-0.5 rounded-full border inline-block mt-0.5', ACTOR_TYPE_COLORS[ev.actor_type] || 'bg-muted text-muted-foreground')}>
                              {ev.actor_type}
                            </span>
                          </td>
                          <td className="px-3 py-2.5">
                            <span className="font-medium text-foreground">{ev.event_type?.replace(/_/g,' ')}</span>
                          </td>
                          <td className="px-3 py-2.5 font-mono text-muted-foreground">
                            {ev.case_id && <div className="truncate max-w-[120px]" title={ev.case_id}>Case: {ev.case_id.slice(-8)}</div>}
                            {ev.client_id && <div className="truncate max-w-[120px]" title={ev.client_id}>Client: {ev.client_id.slice(-8)}</div>}
                          </td>
                          <td className="px-3 py-2.5 text-muted-foreground max-w-xs">
                            <div className="truncate">{ev.notes || '—'}</div>
                          </td>
                          <td className="px-3 py-2.5">
                            {ev.is_override && <span className="text-xs bg-amber-100 text-amber-700 border border-amber-200 px-1.5 py-0.5 rounded-full">Override</span>}
                          </td>
                        </tr>
                        {isExp && (
                          <tr className="bg-muted/10">
                            <td colSpan={6} className="px-4 py-3">
                              <div className="grid grid-cols-2 md:grid-cols-3 gap-4 text-xs">
                                <div>
                                  <div className="text-muted-foreground mb-1 font-semibold uppercase tracking-wide">Full Notes</div>
                                  <div className="text-foreground whitespace-pre-wrap">{ev.notes || '—'}</div>
                                </div>
                                {ev.before_state && (
                                  <div>
                                    <div className="text-muted-foreground mb-1 font-semibold uppercase tracking-wide">Before State</div>
                                    <pre className="bg-muted/50 rounded p-2 text-xs overflow-auto max-h-32 font-mono">{JSON.stringify(ev.before_state, null, 2)}</pre>
                                  </div>
                                )}
                                {ev.after_state && (
                                  <div>
                                    <div className="text-muted-foreground mb-1 font-semibold uppercase tracking-wide">After State</div>
                                    <pre className="bg-muted/50 rounded p-2 text-xs overflow-auto max-h-32 font-mono">{JSON.stringify(ev.after_state, null, 2)}</pre>
                                  </div>
                                )}
                              </div>
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

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>Showing {(page-1)*PAGE_SIZE+1}–{Math.min(page*PAGE_SIZE, filtered.length)} of {filtered.length.toLocaleString()}</span>
            <div className="flex gap-1">
              <Button size="sm" variant="outline" className="h-7 text-xs px-2" disabled={page === 1} onClick={() => setPage(p => p-1)}>← Prev</Button>
              {Array.from({length: Math.min(7, totalPages)}, (_,i) => {
                const p = totalPages <= 7 ? i+1 : page <= 4 ? i+1 : page >= totalPages-3 ? totalPages-6+i : page-3+i;
                return (
                  <Button key={p} size="sm" variant={p === page ? 'default' : 'outline'} className="h-7 text-xs px-2.5" onClick={() => setPage(p)}>{p}</Button>
                );
              })}
              <Button size="sm" variant="outline" className="h-7 text-xs px-2" disabled={page === totalPages} onClick={() => setPage(p => p+1)}>Next →</Button>
            </div>
          </div>
        )}
      </div>
    </AppShell>
  );
}