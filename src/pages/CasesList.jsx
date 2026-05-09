import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import { useTenant } from '@/lib/tenantContext';
import { hasPermission } from '@/lib/permissions';
import AppShell from '@/components/layout/AppShell';
import RiskBadge from '@/components/shared/RiskBadge';
import StatusBadge from '@/components/shared/StatusBadge';
import PageHeader from '@/components/shared/PageHeader';
import EmptyState from '@/components/shared/EmptyState';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  FolderOpen, Search, X, ChevronLeft, ChevronRight,
  ChevronsUpDown, ChevronUp, ChevronDown, Download, UserCheck, Loader2
} from 'lucide-react';
import { format, differenceInDays, isAfter } from 'date-fns';
import { cn } from '@/lib/utils';

const PAGE_SIZE = 25;
const CLOSED = ['Approved', 'Closed', 'Rejected'];

const ALL_STATUSES = [
  'Draft','In_Progress','Outreach_Pending','Screening',
  'Assessment','QC','Compliance_Review','Sign_Off_Pending','Approved','Rejected','Closed'
];
const CASE_TYPES = [
  { value: 'Onboarding',          label: 'Onboarding' },
  { value: 'Periodic_Review',     label: 'Periodic Review' },
  { value: 'Event_Driven_Review', label: 'EDR' },
  { value: 'Offboarding',         label: 'Offboarding' },
];
const RISK_LEVELS = ['Low','Medium','High','Unacceptable'];

function SortIcon({ col, sortKey }) {
  if (sortKey !== col) return <ChevronsUpDown className="w-3 h-3 ml-1 text-muted-foreground/40" />;
  return null;
}

function MultiCheckFilter({ label, options, selected, onChange }) {
  const [open, setOpen] = useState(false);
  const allSelected = selected.length === 0;
  return (
    <div className="relative">
      <button
        onClick={() => setOpen(o => !o)}
        className={cn(
          'h-8 px-3 text-sm rounded-md border flex items-center gap-1.5 whitespace-nowrap transition-colors',
          selected.length > 0
            ? 'border-primary text-primary bg-primary/5'
            : 'border-input bg-background text-foreground hover:bg-muted/50'
        )}
      >
        {label}
        {selected.length > 0 && (
          <span className="bg-primary text-primary-foreground text-xs rounded-full px-1.5 py-0 leading-4 min-w-[18px] text-center">
            {selected.length}
          </span>
        )}
        <ChevronDown className="w-3 h-3 text-muted-foreground ml-0.5" />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute top-9 left-0 z-20 bg-popover border border-border rounded-lg shadow-lg p-1 min-w-[180px]">
            <button
              className="w-full flex items-center gap-2 px-2 py-1.5 text-sm rounded hover:bg-muted/50 text-muted-foreground"
              onClick={() => { onChange([]); setOpen(false); }}
            >
              <span className="text-xs">Clear selection</span>
            </button>
            {options.map(opt => {
              const val = typeof opt === 'string' ? opt : opt.value;
              const lbl = typeof opt === 'string' ? opt.replace(/_/g,' ') : opt.label;
              const checked = selected.includes(val);
              return (
                <button
                  key={val}
                  className="w-full flex items-center gap-2 px-2 py-1.5 text-sm rounded hover:bg-muted/50"
                  onClick={() => onChange(checked ? selected.filter(s => s !== val) : [...selected, val])}
                >
                  <Checkbox checked={checked} className="h-3.5 w-3.5" />
                  <span>{lbl}</span>
                </button>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

export default function CasesList({ myOnly = false }) {
  const { currentUser, tenant } = useTenant();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const [cases, setCases]       = useState([]);
  const [clients, setClients]   = useState({});   // id → client
  const [users, setUsers]       = useState([]);
  const [loading, setLoading]   = useState(true);
  const [page, setPage]         = useState(1);

  // Sort state
  const [sortCol, setSortCol]   = useState('due_date');
  const [sortAsc, setSortAsc]   = useState(true);

  // Filters
  const [search, setSearch]       = useState('');
  const [caseTypes, setCaseTypes] = useState([]);
  const [statuses, setStatuses]   = useState(
    searchParams.get('status') ? [searchParams.get('status')] : []
  );
  const [risks, setRisks]         = useState([]);
  const [analystId, setAnalystId] = useState('all');
  const [dueDateFrom, setDueDateFrom] = useState('');
  const [dueDateTo, setDueDateTo]     = useState('');

  // Bulk actions
  const [selected, setSelected]   = useState(new Set());
  const [reassignTo, setReassignTo] = useState('');
  const [bulkWorking, setBulkWorking] = useState(false);

  const userRole = currentUser?.app_role;
  const canBulk  = !myOnly && hasPermission(userRole, 'bulkActions');

  useEffect(() => {
    if (currentUser?.tenant_id) loadAll();
  }, [currentUser]);

  async function loadAll() {
    setLoading(true);
    const query = { tenant_id: currentUser.tenant_id };
    if (myOnly) query.assigned_analyst_id = currentUser.id;
    const [casesData, clientsData, usersData] = await Promise.all([
      base44.entities.KycCase.filter(query, '-created_date', 1000),
      base44.entities.Client.filter({ tenant_id: currentUser.tenant_id }),
      base44.entities.User.filter({ tenant_id: currentUser.tenant_id }).catch(() => []),
    ]);
    setCases(casesData || []);
    const cm = {};
    (clientsData || []).forEach(c => { cm[c.id] = c; });
    setClients(cm);
    setUsers(usersData || []);
    setLoading(false);
  }

  function clearFilters() {
    setSearch(''); setCaseTypes([]); setStatuses([]); setRisks([]);
    setAnalystId('all'); setDueDateFrom(''); setDueDateTo('');
    setPage(1); setSelected(new Set());
  }

  const hasActiveFilters = search || caseTypes.length || statuses.length || risks.length ||
    analystId !== 'all' || dueDateFrom || dueDateTo;

  const filtered = useMemo(() => {
    return cases.filter(c => {
      const client = clients[c.client_id];
      const clientName = client?.full_name || '';
      if (search && !clientName.toLowerCase().includes(search.toLowerCase())) return false;
      if (caseTypes.length && !caseTypes.includes(c.case_type)) return false;
      if (statuses.length && !statuses.includes(c.status)) return false;
      if (risks.length) {
        const r = c.risk_classification || 'Unclassified';
        if (!risks.includes(r)) return false;
      }
      if (analystId !== 'all' && c.assigned_analyst_id !== analystId) return false;
      if (dueDateFrom && c.due_date && c.due_date < dueDateFrom) return false;
      if (dueDateTo && c.due_date && c.due_date > dueDateTo) return false;
      return true;
    });
  }, [cases, clients, search, caseTypes, statuses, risks, analystId, dueDateFrom, dueDateTo]);

  const sorted = useMemo(() => {
    return [...filtered].sort((a, b) => {
      let av, bv;
      if (sortCol === 'client_name') {
        av = clients[a.client_id]?.full_name || '';
        bv = clients[b.client_id]?.full_name || '';
      } else if (sortCol === 'client_type') {
        av = clients[a.client_id]?.client_type || '';
        bv = clients[b.client_id]?.client_type || '';
      } else if (sortCol === 'due_date') {
        av = a.due_date || '9999'; bv = b.due_date || '9999';
      } else if (sortCol === 'days_open') {
        av = a.created_date ? new Date(a.created_date) : new Date();
        bv = b.created_date ? new Date(b.created_date) : new Date();
        return sortAsc ? av - bv : bv - av;
      } else if (sortCol === 'risk') {
        const order = { Low:0, Medium:1, High:2, Unacceptable:3 };
        av = order[a.risk_classification] ?? 4;
        bv = order[b.risk_classification] ?? 4;
      } else {
        av = a[sortCol] || ''; bv = b[sortCol] || '';
      }
      if (av < bv) return sortAsc ? -1 : 1;
      if (av > bv) return sortAsc ? 1 : -1;
      return 0;
    });
  }, [filtered, sortCol, sortAsc, clients]);

  const totalPages = Math.ceil(sorted.length / PAGE_SIZE);
  const paged = sorted.slice((page-1)*PAGE_SIZE, page*PAGE_SIZE);

  function handleSort(col) {
    if (sortCol === col) setSortAsc(a => !a);
    else { setSortCol(col); setSortAsc(true); }
    setPage(1);
  }

  function toggleRow(id) {
    setSelected(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  function toggleAll() {
    if (selected.size === paged.length) setSelected(new Set());
    else setSelected(new Set(paged.map(c => c.id)));
  }

  async function handleReassign() {
    if (!reassignTo || selected.size === 0) return;
    setBulkWorking(true);
    await Promise.all([...selected].map(id => base44.entities.KycCase.update(id, { assigned_analyst_id: reassignTo })));
    await loadAll();
    setSelected(new Set()); setReassignTo('');
    setBulkWorking(false);
  }

  function handleExportCSV() {
    const rows = sorted.filter(c => selected.size === 0 || selected.has(c.id));
    const headers = ['Client Name','Client Type','Case Type','Status','Risk Class','Assigned Analyst','Due Date','Days Open'];
    const lines = rows.map(c => {
      const client = clients[c.client_id];
      const analyst = users.find(u => u.id === c.assigned_analyst_id);
      const daysOpen = c.created_date ? differenceInDays(new Date(), new Date(c.created_date)) : '';
      return [
        client?.full_name || '',
        client?.client_type || '',
        c.case_type?.replace(/_/g,' ') || '',
        c.status || '',
        c.risk_classification || '',
        analyst?.full_name || '',
        c.due_date || '',
        daysOpen,
      ].map(v => `"${v}"`).join(',');
    });
    const csv = [headers.join(','), ...lines].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `cases-${format(new Date(),'yyyyMMdd')}.csv`; a.click();
    URL.revokeObjectURL(url);
  }

  function SortTh({ col, label, className }) {
    return (
      <th
        className={cn('text-left px-4 py-3 cursor-pointer select-none whitespace-nowrap', className)}
        onClick={() => handleSort(col)}
      >
        <span className="flex items-center gap-0.5">
          {label}
          {sortCol === col
            ? sortAsc ? <ChevronUp className="w-3 h-3 ml-0.5" /> : <ChevronDown className="w-3 h-3 ml-0.5" />
            : <ChevronsUpDown className="w-3 h-3 ml-0.5 opacity-30" />
          }
        </span>
      </th>
    );
  }

  const title    = myOnly ? 'My Cases' : 'All Cases';
  const subtitle = myOnly
    ? `${filtered.length} cases assigned to you`
    : `${filtered.length} cases · ${tenant?.name}`;

  return (
    <AppShell>
      <div className="p-6 space-y-4 max-w-screen-2xl mx-auto">
        <PageHeader title={title} subtitle={subtitle} />

        {/* Filters Bar */}
        <div className="bg-card border border-border rounded-xl p-4 space-y-3">
          <div className="flex flex-wrap gap-2 items-center">
            {/* Search */}
            <div className="relative flex-1 min-w-48 max-w-64">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
              <Input
                placeholder="Search client name…"
                value={search}
                onChange={e => { setSearch(e.target.value); setPage(1); }}
                className="pl-8 h-8 text-sm"
              />
            </div>

            <MultiCheckFilter
              label="Case Type"
              options={CASE_TYPES}
              selected={caseTypes}
              onChange={v => { setCaseTypes(v); setPage(1); }}
            />
            <MultiCheckFilter
              label="Status"
              options={ALL_STATUSES}
              selected={statuses}
              onChange={v => { setStatuses(v); setPage(1); }}
            />
            <MultiCheckFilter
              label="Risk Class"
              options={[...RISK_LEVELS, 'Unclassified']}
              selected={risks}
              onChange={v => { setRisks(v); setPage(1); }}
            />

            {/* Analyst filter — S-012 only */}
            {!myOnly && (
              <Select value={analystId} onValueChange={v => { setAnalystId(v); setPage(1); }}>
                <SelectTrigger className={cn('h-8 text-sm w-44', analystId !== 'all' && 'border-primary text-primary bg-primary/5')}>
                  <SelectValue placeholder="Analyst" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Analysts</SelectItem>
                  {users.map(u => (
                    <SelectItem key={u.id} value={u.id}>{u.full_name || u.email}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}

            {/* Due Date range */}
            <div className="flex items-center gap-1">
              <input
                type="date"
                value={dueDateFrom}
                onChange={e => { setDueDateFrom(e.target.value); setPage(1); }}
                className={cn(
                  'h-8 px-2 text-sm rounded-md border border-input bg-background text-foreground',
                  dueDateFrom && 'border-primary bg-primary/5'
                )}
                placeholder="From"
              />
              <span className="text-xs text-muted-foreground">–</span>
              <input
                type="date"
                value={dueDateTo}
                onChange={e => { setDueDateTo(e.target.value); setPage(1); }}
                className={cn(
                  'h-8 px-2 text-sm rounded-md border border-input bg-background text-foreground',
                  dueDateTo && 'border-primary bg-primary/5'
                )}
                placeholder="To"
              />
            </div>

            {hasActiveFilters && (
              <Button variant="ghost" size="sm" onClick={clearFilters} className="gap-1 h-8 text-sm text-muted-foreground">
                <X className="w-3 h-3" /> Clear
              </Button>
            )}
          </div>
        </div>

        {/* Bulk action bar */}
        {canBulk && selected.size > 0 && (
          <div className="bg-primary/5 border border-primary/20 rounded-xl px-4 py-2.5 flex items-center gap-3 flex-wrap">
            <span className="text-sm font-medium text-primary">{selected.size} selected</span>
            <div className="flex items-center gap-2 ml-auto flex-wrap">
              <Select value={reassignTo} onValueChange={setReassignTo}>
                <SelectTrigger className="h-8 text-sm w-44">
                  <SelectValue placeholder="Reassign to…" />
                </SelectTrigger>
                <SelectContent>
                  {users.map(u => (
                    <SelectItem key={u.id} value={u.id}>{u.full_name || u.email}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button size="sm" className="h-8 gap-1.5 text-xs" onClick={handleReassign} disabled={!reassignTo || bulkWorking}>
                {bulkWorking ? <Loader2 className="w-3 h-3 animate-spin" /> : <UserCheck className="w-3 h-3" />}
                Reassign
              </Button>
              <Button size="sm" variant="outline" className="h-8 gap-1.5 text-xs" onClick={handleExportCSV}>
                <Download className="w-3 h-3" /> Export CSV
              </Button>
              <Button size="sm" variant="ghost" className="h-8 text-xs text-muted-foreground" onClick={() => setSelected(new Set())}>
                Cancel
              </Button>
            </div>
          </div>
        )}

        {/* Table */}
        <div className="bg-card border border-border rounded-xl overflow-hidden">
          {loading ? (
            <div className="p-8 text-center text-muted-foreground text-sm">Loading cases…</div>
          ) : sorted.length === 0 ? (
            <EmptyState
              icon={FolderOpen}
              title="No cases match your filters"
              description="Try adjusting your search or clearing the filters."
              action={hasActiveFilters ? <Button variant="outline" size="sm" onClick={clearFilters}>Clear Filters</Button> : null}
            />
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-muted/40 border-b border-border text-xs text-muted-foreground uppercase tracking-wide">
                      {canBulk && (
                        <th className="px-4 py-3 w-8">
                          <Checkbox
                            checked={paged.length > 0 && paged.every(c => selected.has(c.id))}
                            onCheckedChange={toggleAll}
                            className="h-3.5 w-3.5"
                          />
                        </th>
                      )}
                      <SortTh col="client_name" label="Client Name" />
                      <SortTh col="client_type" label="Type" />
                      <SortTh col="case_type" label="Case Type" />
                      <SortTh col="status" label="Status" />
                      <SortTh col="risk" label="Risk Class" />
                      {!myOnly && <th className="text-left px-4 py-3">Analyst</th>}
                      <SortTh col="due_date" label="Due Date" />
                      <SortTh col="days_open" label="Days Open" />
                      <th className="px-4 py-3 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {paged.map(c => {
                      const client   = clients[c.client_id];
                      const analyst  = users.find(u => u.id === c.assigned_analyst_id);
                      const daysOpen = c.created_date ? differenceInDays(new Date(), new Date(c.created_date)) : 0;
                      const isOverdue = c.due_date && isAfter(new Date(), new Date(c.due_date)) && !CLOSED.includes(c.status);
                      const isChecked = selected.has(c.id);
                      return (
                        <tr
                          key={c.id}
                          className={cn('hover:bg-muted/30 transition-colors cursor-pointer', isChecked && 'bg-primary/5')}
                          onClick={() => navigate(`/case/${c.id}`)}
                        >
                          {canBulk && (
                            <td className="px-4 py-3" onClick={e => { e.stopPropagation(); toggleRow(c.id); }}>
                              <Checkbox checked={isChecked} className="h-3.5 w-3.5" />
                            </td>
                          )}
                          <td className="px-4 py-3 font-medium text-foreground max-w-[200px] truncate">
                            {client?.full_name || <span className="text-muted-foreground text-xs italic">Loading…</span>}
                          </td>
                          <td className="px-4 py-3">
                            {client?.client_type && (
                              <span className={cn('text-xs font-medium px-1.5 py-0.5 rounded',
                                client.client_type === 'ORG' ? 'bg-blue-100 text-blue-700' : 'bg-violet-100 text-violet-700'
                              )}>
                                {client.client_type}
                              </span>
                            )}
                          </td>
                          <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">
                            {c.case_type?.replace(/_/g,' ') || '—'}
                          </td>
                          <td className="px-4 py-3"><StatusBadge status={c.status} /></td>
                          <td className="px-4 py-3"><RiskBadge risk={c.risk_classification} /></td>
                          {!myOnly && (
                            <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">
                              {analyst?.full_name || '—'}
                            </td>
                          )}
                          <td className={cn('px-4 py-3 text-xs whitespace-nowrap', isOverdue ? 'text-red-600 font-semibold' : 'text-muted-foreground')}>
                            {c.due_date ? format(new Date(c.due_date), 'd MMM yyyy') : '—'}
                            {isOverdue && ' ⚠'}
                          </td>
                          <td className="px-4 py-3 text-xs text-muted-foreground tabular-nums">{daysOpen}d</td>
                          <td className="px-4 py-3 text-right">
                            <Button
                              variant="outline" size="sm" className="h-7 text-xs"
                              onClick={e => { e.stopPropagation(); navigate(`/case/${c.id}`); }}
                            >
                              Open →
                            </Button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* Pagination */}
              <div className="flex items-center justify-between px-4 py-3 border-t border-border">
                <span className="text-xs text-muted-foreground">
                  {sorted.length === 0 ? '0 results' : `Showing ${(page-1)*PAGE_SIZE+1}–${Math.min(page*PAGE_SIZE, sorted.length)} of ${sorted.length}`}
                </span>
                {totalPages > 1 && (
                  <div className="flex items-center gap-2">
                    <Button variant="outline" size="sm" className="h-7 w-7 p-0" onClick={() => setPage(p=>p-1)} disabled={page===1}>
                      <ChevronLeft className="w-3 h-3" />
                    </Button>
                    <span className="text-xs text-muted-foreground">{page} / {totalPages}</span>
                    <Button variant="outline" size="sm" className="h-7 w-7 p-0" onClick={() => setPage(p=>p+1)} disabled={page===totalPages}>
                      <ChevronRight className="w-3 h-3" />
                    </Button>
                  </div>
                )}
              </div>
            </>
          )}
        </div>

        {/* Footer export for non-bulk users */}
        {!canBulk && sorted.length > 0 && hasPermission(userRole, 'exportData') && (
          <div className="flex justify-end">
            <Button variant="outline" size="sm" className="gap-1.5 text-xs" onClick={handleExportCSV}>
              <Download className="w-3 h-3" /> Export CSV
            </Button>
          </div>
        )}
      </div>
    </AppShell>
  );
}