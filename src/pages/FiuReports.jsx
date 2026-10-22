import React, { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { base44 } from '@/api/base44Client';
import { useTenant } from '@/lib/tenantContext';
import { useTenantClients } from '@/hooks/useTenantData';
import { isFeatureEnabled } from '@/lib/featureFlags';
import { download } from '@/lib/tmQuality';
import AppShell from '@/components/layout/AppShell';
import PageHeader from '@/components/shared/PageHeader';
import EmptyState from '@/components/shared/EmptyState';
import InlineError from '@/components/shared/InlineError';
import DeadlineCell from '@/components/tm/alerts/DeadlineCell';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { Download, Loader2, Lock, FileText } from 'lucide-react';

// Roles that may read FiuArtefact (entity RLS read list).
const FIU_READERS = ['Analyst', 'QC Reviewer', 'Compliance Officer', 'Manager', 'Director', 'Compliance Admin', 'Tenant Admin'];
const STATUSES = ['draft', 'in_review', 'approved', 'generated', 'submitted', 'received', 'accepted', 'rejected'];
const BASE_LABEL = {
  draft: 'Draft', in_review: 'In review', approved: 'Approved', generated: 'Generated · not yet submitted',
  submitted: 'Submitted', received: 'Received', accepted: 'Accepted', rejected: 'Rejected',
};
const TONE = {
  draft: 'bg-secondary text-muted-foreground border-border', in_review: 'bg-amber-50 text-amber-700 border-amber-200',
  approved: 'bg-sky-50 text-sky-700 border-sky-200', generated: 'bg-violet-50 text-violet-700 border-violet-200',
  submitted: 'bg-teal-50 text-teal-700 border-teal-200', received: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  accepted: 'bg-emerald-50 text-emerald-700 border-emerald-200', rejected: 'bg-red-50 text-red-700 border-red-200',
};
const PRE_SUBMISSION = ['draft', 'in_review', 'approved', 'generated'];
const TYPE_LABEL = { unusual_objective: 'Objective', unusual_subjective: 'Subjective' };
const list = (res) => (Array.isArray(res) ? res : res?.items || []);
const statusText = (r) => (r.status === 'received' && r.received?.fiu_reference ? `Received · ${r.received.fiu_reference}` : BASE_LABEL[r.status] || r.status);
const csvCell = (v) => { const s = String(v ?? ''); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };

/** FIU report list (/tm/reports). Tenant-scoped, refreshed in realtime via FiuReport.subscribe. */
export default function FiuReports() {
  const { currentUser, tenant } = useTenant();
  const tenantId = currentUser?.tenant_id;
  const navigate = useNavigate();
  const qc = useQueryClient();
  const allowed = isFeatureEnabled(tenant, 'tm_core') && isFeatureEnabled(tenant, 'tm_fiu') && FIU_READERS.includes(currentUser?.app_role);
  const [searchParams] = useSearchParams();
  const initialStatus = searchParams.get('status');
  const [status, setStatus] = useState(STATUSES.includes(initialStatus) ? initialStatus : 'all');
  const [fiuCode, setFiuCode] = useState('all');
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 60000); return () => clearInterval(t); }, []);

  const reportsQ = useQuery({
    queryKey: ['fiuReportsList', tenantId],
    enabled: allowed && !!tenantId,
    queryFn: async () => list(await base44.entities.FiuReport.filter({ tenant_id: tenantId }, { sort: '-created_date', limit: 500 })),
  });
  const { data: profiles = [] } = useQuery({
    queryKey: ['fiuProfilesList', tenantId],
    enabled: allowed && !!tenantId,
    queryFn: async () => list(await base44.entities.FiuProfile.filter({ tenant_id: tenantId })),
  });
  const { data: clients } = useTenantClients(tenantId, { enabled: allowed });
  const clientsById = useMemo(() => new Map((clients || []).map((c) => [c.id, c])), [clients]);
  const fiuName = (code) => profiles.find((p) => p.code === code)?.name || code || '—';

  useEffect(() => {
    if (!allowed || !tenantId) return undefined;
    let timer;
    const unsub = base44.entities.FiuReport.subscribe((event) => {
      if (event?.data?.tenant_id && event.data.tenant_id !== tenantId) return;
      clearTimeout(timer);
      timer = setTimeout(() => qc.invalidateQueries({ queryKey: ['fiuReportsList', tenantId] }), 600);
    });
    return () => { clearTimeout(timer); unsub?.(); };
  }, [allowed, tenantId, qc]);

  if (!allowed) return <AppShell><EmptyState icon={Lock} title="Not available" description="FIU reports need Transaction Monitoring and FIU reporting to be enabled, and the right permission." /></AppShell>;

  const all = reportsQ.data || [];
  const codes = [...new Set(all.map((r) => r.fiu_profile_code).filter(Boolean))];
  const rows = all.filter((r) => (status === 'all' || r.status === status) && (fiuCode === 'all' || r.fiu_profile_code === fiuCode));

  const exportCsv = () => {
    const head = ['Report ref', 'FIU', 'Type', 'Status', 'FIU reference', 'Deadline', 'Customer', 'TM case id', 'KYC case id'];
    const lines = rows.map((r) => [
      r.report_ref, fiuName(r.fiu_profile_code), TYPE_LABEL[r.type] || r.type, statusText(r), r.received?.fiu_reference || '',
      r.clock?.due_at || '', clientsById.get(r.client_id)?.full_name || r.client_id || '', r.tm_case_id || '', r.kyc_case_id || '',
    ].map(csvCell).join(','));
    download(`fiu-reports_${format(new Date(), 'yyyy-MM-dd')}.csv`, [head.join(','), ...lines].join('\n'), 'text/csv');
  };

  return (
    <AppShell>
      <div className="max-w-7xl mx-auto px-4 md:px-6 py-6">
        <PageHeader
          title="FIU Reports"
          subtitle="Unusual transaction reports to the Financial Intelligence Unit"
          actions={<Button variant="outline" size="sm" className="gap-1.5" disabled={!rows.length} onClick={exportCsv}><Download className="w-3.5 h-3.5" /> Export CSV</Button>}
        />
        <div className="flex flex-wrap gap-2 mb-4">
          <Select value={status} onValueChange={setStatus}>
            <SelectTrigger className="h-8 w-56 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all" className="text-xs">All statuses</SelectItem>
              {STATUSES.map((s) => <SelectItem key={s} value={s} className="text-xs">{BASE_LABEL[s]}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={fiuCode} onValueChange={setFiuCode}>
            <SelectTrigger className="h-8 w-48 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all" className="text-xs">All FIUs</SelectItem>
              {codes.map((c) => <SelectItem key={c} value={c} className="text-xs">{fiuName(c)}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        {reportsQ.isLoading ? <div className="flex justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>
          : reportsQ.error ? <InlineError message="Couldn't load FIU reports." onRetry={() => reportsQ.refetch()} />
          : rows.length === 0 ? <EmptyState icon={FileText} title="No reports" description="No FIU report matches these filters." />
          : (
            <div className="bg-card border border-border rounded-xl overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-[11px] uppercase tracking-wider text-muted-foreground border-b border-border">
                    {['Report', 'FIU', 'Type', 'Status', 'Deadline', 'Customer', 'Cases'].map((h) => <th key={h} className="px-3 py-2 font-semibold">{h}</th>)}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {rows.map((r) => (
                    <tr key={r.id} className="hover:bg-muted/30 cursor-pointer" onClick={() => navigate(`/tm/report/${r.id}`)}>
                      <td className="px-3 py-2.5 font-medium">{r.report_ref || '—'}</td>
                      <td className="px-3 py-2.5 text-xs">{fiuName(r.fiu_profile_code)}</td>
                      <td className="px-3 py-2.5 text-xs">{TYPE_LABEL[r.type] || r.type || '—'}</td>
                      <td className="px-3 py-2.5"><span className={cn('text-[11px] font-medium px-2 py-0.5 rounded-full border whitespace-nowrap', TONE[r.status] || TONE.draft)}>{statusText(r)}</span></td>
                      <td className="px-3 py-2.5">
                        {PRE_SUBMISSION.includes(r.status) ? <DeadlineCell alert={{ due_at: r.clock?.due_at }} now={now} />
                          : <span className="text-xs text-muted-foreground">{r.clock?.due_at ? format(new Date(r.clock.due_at), 'd MMM yyyy HH:mm') : '—'}</span>}
                      </td>
                      <td className="px-3 py-2.5">
                        {r.client_id ? <Link to={`/client/${r.client_id}?tab=overview`} onClick={(e) => e.stopPropagation()} className="text-primary hover:underline">{clientsById.get(r.client_id)?.full_name || 'Customer'}</Link> : '—'}
                      </td>
                      <td className="px-3 py-2.5 text-xs space-x-2 whitespace-nowrap">
                        {r.tm_case_id && <Link to={`/tm/case/${r.tm_case_id}`} onClick={(e) => e.stopPropagation()} className="text-primary hover:underline">TM case</Link>}
                        {r.kyc_case_id && <Link to={`/case/${r.kyc_case_id}`} onClick={(e) => e.stopPropagation()} className="text-primary hover:underline">KYC case</Link>}
                        {!r.tm_case_id && !r.kyc_case_id && '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
      </div>
    </AppShell>
  );
}
