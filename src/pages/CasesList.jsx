import React, { useState, useEffect } from 'react';
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { FolderOpen, Search, X, ChevronLeft, ChevronRight } from 'lucide-react';
import { format, differenceInDays, isAfter } from 'date-fns';
import { cn } from '@/lib/utils';

const PAGE_SIZE = 25;

export default function CasesList({ myOnly = false }) {
  const { currentUser } = useTenant();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [cases, setCases] = useState([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);

  const [filters, setFilters] = useState({
    search: '',
    caseType: 'all',
    status: searchParams.get('status') || 'all',
    risk: 'all',
  });

  const userRole = currentUser?.app_role;

  useEffect(() => {
    if (currentUser?.tenant_id) loadCases();
  }, [currentUser]);

  async function loadCases() {
    setLoading(true);
    const query = { tenant_id: currentUser.tenant_id };
    if (myOnly) query.assigned_analyst_id = currentUser.id;
    const data = await base44.entities.KycCase.filter(query, '-created_date', 500);
    setCases(data || []);
    setLoading(false);
  }

  const filtered = cases.filter(c => {
    const clientName = c.client_name || '';
    if (filters.search && !clientName.toLowerCase().includes(filters.search.toLowerCase())) return false;
    if (filters.caseType !== 'all' && c.case_type !== filters.caseType) return false;
    if (filters.status !== 'all' && c.status !== filters.status) return false;
    if (filters.risk !== 'all' && c.risk_classification !== filters.risk) return false;
    return true;
  });

  const totalPages = Math.ceil(filtered.length / PAGE_SIZE);
  const paged = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  function clearFilters() {
    setFilters({ search: '', caseType: 'all', status: 'all', risk: 'all' });
    setPage(1);
  }

  const title = myOnly ? 'My Cases' : 'All Cases';
  const subtitle = myOnly
    ? 'Cases assigned to you'
    : `All cases for ${currentUser?.tenant_id ? 'this tenant' : ''}`;

  return (
    <AppShell>
      <div className="p-6 space-y-4 max-w-screen-2xl mx-auto">
        <PageHeader title={title} subtitle={subtitle} />

        {/* Filters */}
        <div className="bg-card border border-border rounded-xl p-4">
          <div className="flex flex-wrap gap-3 items-end">
            <div className="relative flex-1 min-w-48">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
              <Input
                placeholder="Search client name…"
                value={filters.search}
                onChange={e => { setFilters(f => ({ ...f, search: e.target.value })); setPage(1); }}
                className="pl-8 h-8 text-sm"
              />
            </div>
            <Select value={filters.caseType} onValueChange={v => { setFilters(f => ({ ...f, caseType: v })); setPage(1); }}>
              <SelectTrigger className="h-8 text-sm w-40">
                <SelectValue placeholder="Case Type" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Types</SelectItem>
                <SelectItem value="Onboarding">Onboarding</SelectItem>
                <SelectItem value="Periodic_Review">Periodic Review</SelectItem>
                <SelectItem value="Event_Driven_Review">EDR</SelectItem>
                <SelectItem value="Offboarding">Offboarding</SelectItem>
              </SelectContent>
            </Select>
            <Select value={filters.status} onValueChange={v => { setFilters(f => ({ ...f, status: v })); setPage(1); }}>
              <SelectTrigger className="h-8 text-sm w-44">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Statuses</SelectItem>
                {['Draft','In_Progress','Outreach_Pending','Screening','Assessment','QC','Sign_Off_Pending','Approved','Rejected','Closed'].map(s => (
                  <SelectItem key={s} value={s}>{s.replace(/_/g,' ')}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={filters.risk} onValueChange={v => { setFilters(f => ({ ...f, risk: v })); setPage(1); }}>
              <SelectTrigger className="h-8 text-sm w-36">
                <SelectValue placeholder="Risk Class" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Risks</SelectItem>
                <SelectItem value="Low">Low</SelectItem>
                <SelectItem value="Medium">Medium</SelectItem>
                <SelectItem value="High">High</SelectItem>
                <SelectItem value="Unacceptable">Unacceptable</SelectItem>
              </SelectContent>
            </Select>
            <Button variant="ghost" size="sm" onClick={clearFilters} className="gap-1 h-8 text-sm">
              <X className="w-3 h-3" /> Clear
            </Button>
          </div>
        </div>

        {/* Table */}
        <div className="bg-card border border-border rounded-xl overflow-hidden">
          {loading ? (
            <div className="p-8 text-center text-muted-foreground text-sm">Loading cases…</div>
          ) : filtered.length === 0 ? (
            <EmptyState
              icon={FolderOpen}
              title="No cases match your filters"
              description="Try adjusting your search or clearing the filters."
              action={<Button variant="outline" size="sm" onClick={clearFilters}>Clear Filters</Button>}
            />
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-muted/40 border-b border-border text-xs text-muted-foreground uppercase tracking-wide">
                      <th className="text-left px-4 py-3">Client Name</th>
                      <th className="text-left px-4 py-3">Type</th>
                      <th className="text-left px-4 py-3">Case Type</th>
                      <th className="text-left px-4 py-3">Status</th>
                      <th className="text-left px-4 py-3">Risk Class</th>
                      <th className="text-left px-4 py-3">Due Date</th>
                      <th className="text-left px-4 py-3">Days Open</th>
                      <th className="px-4 py-3">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {paged.map(c => {
                      const daysOpen = c.created_date ? differenceInDays(new Date(), new Date(c.created_date)) : 0;
                      const isOverdue = c.due_date && isAfter(new Date(), new Date(c.due_date)) && !['Approved', 'Closed', 'Rejected'].includes(c.status);
                      return (
                        <tr key={c.id} className="hover:bg-muted/30 transition-colors cursor-pointer" onClick={() => navigate(`/case/${c.id}`)}>
                          <td className="px-4 py-3 font-medium text-foreground">
                            {c.client_name || c.client_id?.slice(0,8)+'…'}
                          </td>
                          <td className="px-4 py-3">
                            {c.client_type && (
                              <span className={cn('text-xs font-medium px-1.5 py-0.5 rounded', c.client_type === 'ORG' ? 'bg-blue-100 text-blue-700' : 'bg-violet-100 text-violet-700')}>
                                {c.client_type}
                              </span>
                            )}
                          </td>
                          <td className="px-4 py-3 text-xs text-muted-foreground">{c.case_type?.replace(/_/g,' ') || '—'}</td>
                          <td className="px-4 py-3"><StatusBadge status={c.status} /></td>
                          <td className="px-4 py-3"><RiskBadge risk={c.risk_classification} /></td>
                          <td className={cn('px-4 py-3 text-xs', isOverdue ? 'text-red-600 font-semibold' : 'text-muted-foreground')}>
                            {c.due_date ? format(new Date(c.due_date), 'd MMM yyyy') : '—'}
                          </td>
                          <td className="px-4 py-3 text-xs text-muted-foreground">{daysOpen}</td>
                          <td className="px-4 py-3 text-right">
                            <Button variant="outline" size="sm" className="text-xs h-7">Open →</Button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {/* Pagination */}
              {totalPages > 1 && (
                <div className="flex items-center justify-between px-4 py-3 border-t border-border">
                  <span className="text-xs text-muted-foreground">
                    Showing {(page-1)*PAGE_SIZE+1}–{Math.min(page*PAGE_SIZE, filtered.length)} of {filtered.length}
                  </span>
                  <div className="flex items-center gap-2">
                    <Button variant="outline" size="sm" className="h-7 w-7 p-0" onClick={() => setPage(p => p-1)} disabled={page===1}>
                      <ChevronLeft className="w-3 h-3" />
                    </Button>
                    <span className="text-xs text-muted-foreground">{page} / {totalPages}</span>
                    <Button variant="outline" size="sm" className="h-7 w-7 p-0" onClick={() => setPage(p => p+1)} disabled={page===totalPages}>
                      <ChevronRight className="w-3 h-3" />
                    </Button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </AppShell>
  );
}