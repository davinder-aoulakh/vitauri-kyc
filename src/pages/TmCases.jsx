import React, { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { useTenant } from '@/lib/tenantContext';
import { useTenantClients } from '@/hooks/useTenantData';
import { useCaseUsers } from '@/hooks/useTmCase';
import { isFeatureEnabled } from '@/lib/featureFlags';
import { hasPermission } from '@/lib/permissions';
import { CASE_STATUS_LABEL } from '@/lib/tmCase';
import AppShell from '@/components/layout/AppShell';
import PageHeader from '@/components/shared/PageHeader';
import EmptyState from '@/components/shared/EmptyState';
import InlineError from '@/components/shared/InlineError';
import DeadlineCell from '@/components/tm/alerts/DeadlineCell';
import { cn } from '@/lib/utils';
import { Loader2, Lock, Briefcase } from 'lucide-react';

const OPEN = ['open', 'investigating', 'pending_co'];
const DAY = 86400000;
const FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'mine', label: 'Assigned to me' },
  { key: 'pending_co', label: 'Pending CO' },
  { key: 'soon', label: 'Due < 24 h' },
  { key: 'expired', label: 'Expired' },
];
const list = (res) => (Array.isArray(res) ? res : res?.items || []);

function applyFilter(cases, filter, userId, now) {
  const due = (c) => (c.due_at ? new Date(c.due_at).getTime() : null);
  switch (filter) {
    case 'mine': return cases.filter((c) => c.assigned_to_user_id === userId || c.four_eyes_user_id === userId);
    case 'pending_co': return cases.filter((c) => c.status === 'pending_co');
    case 'soon': return cases.filter((c) => OPEN.includes(c.status) && due(c) != null && due(c) >= now && due(c) - now < DAY);
    case 'expired': return cases.filter((c) => OPEN.includes(c.status) && due(c) != null && due(c) < now);
    default: return cases;
  }
}

/** TM investigation case list (/tm/cases). Tenant-scoped, refreshed in realtime via TmCase.subscribe. */
export default function TmCases() {
  const { currentUser, tenant } = useTenant();
  const tenantId = currentUser?.tenant_id;
  const navigate = useNavigate();
  const qc = useQueryClient();
  const allowed = isFeatureEnabled(tenant, 'tm_core') && hasPermission(currentUser?.app_role, 'tmViewAlerts');
  const [searchParams] = useSearchParams();
  const initialFilter = searchParams.get('filter');
  const [filter, setFilter] = useState(FILTERS.some((f) => f.key === initialFilter) ? initialFilter : 'all');
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 60000); return () => clearInterval(t); }, []);

  const casesQ = useQuery({
    queryKey: ['tmCasesList', tenantId],
    enabled: allowed && !!tenantId,
    queryFn: async () => {
      const cases = list(await base44.entities.TmCase.filter({ tenant_id: tenantId }, { sort: '-created_date', limit: 500 }));
      const ids = cases.map((c) => c.id);
      if (!ids.length) return { cases, maxScore: {}, kycByCase: {} };
      const [alerts, kycs] = await Promise.all([
        base44.entities.TmAlert.filter({ tenant_id: tenantId, tm_case_id: { $in: ids } }, { limit: 2000, fields: ['tm_case_id', 'score'] }).then(list),
        base44.entities.KycCase.filter({ tenant_id: tenantId, tm_case_id: { $in: ids } }, { limit: 500, fields: ['id', 'tm_case_id'] }).then(list),
      ]);
      const maxScore = {};
      alerts.forEach((a) => { if (a.score != null) maxScore[a.tm_case_id] = Math.max(maxScore[a.tm_case_id] ?? -Infinity, a.score); });
      const kycByCase = {};
      kycs.forEach((k) => { kycByCase[k.tm_case_id] ||= k.id; });
      return { cases, maxScore, kycByCase };
    },
  });
  const { data: users = [] } = useCaseUsers(tenantId, allowed);
  const { data: clients } = useTenantClients(tenantId, { enabled: allowed });
  const clientsById = useMemo(() => new Map((clients || []).map((c) => [c.id, c])), [clients]);
  const usersById = useMemo(() => new Map(users.map((u) => [u.id, u])), [users]);

  useEffect(() => {
    if (!allowed || !tenantId) return undefined;
    let timer;
    const unsub = base44.entities.TmCase.subscribe((event) => {
      if (event?.data?.tenant_id && event.data.tenant_id !== tenantId) return;
      clearTimeout(timer);
      timer = setTimeout(() => qc.invalidateQueries({ queryKey: ['tmCasesList', tenantId] }), 600);
    });
    return () => { clearTimeout(timer); unsub?.(); };
  }, [allowed, tenantId, qc]);

  if (!allowed) return <AppShell><EmptyState icon={Lock} title="Not available" description="TM cases need Transaction Monitoring to be enabled and permission to view alerts." /></AppShell>;

  const data = casesQ.data;
  const rows = data ? applyFilter(data.cases, filter, currentUser?.id, now) : [];
  const name = (id) => { const u = usersById.get(id); return u?.full_name || u?.name || u?.email || '—'; };

  return (
    <AppShell>
      <div className="max-w-7xl mx-auto px-4 md:px-6 py-6">
        <PageHeader title="TM Cases" subtitle="Transaction monitoring investigations" />
        <div className="flex flex-wrap gap-2 mb-4" role="tablist" aria-label="Case filters">
          {FILTERS.map((f) => (
            <button key={f.key} role="tab" aria-selected={filter === f.key} onClick={() => setFilter(f.key)}
              className={cn('px-3.5 py-1.5 rounded-full text-xs font-medium border transition-colors',
                filter === f.key ? 'bg-primary text-primary-foreground border-primary' : 'bg-card text-muted-foreground border-border hover:text-foreground')}>
              {f.label}
            </button>
          ))}
        </div>
        {casesQ.isLoading ? <div className="flex justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>
          : casesQ.error ? <InlineError message="Couldn't load TM cases." onRetry={() => casesQ.refetch()} />
          : rows.length === 0 ? <EmptyState icon={Briefcase} title="No cases" description="No TM case matches this filter." />
          : (
            <div className="bg-card border border-border rounded-xl overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-[11px] uppercase tracking-wider text-muted-foreground border-b border-border">
                    {['Case', 'Customer', 'Alerts', 'Max score', 'Status', 'Assignee', '4-eyes reviewer', 'Clock', 'KYC case'].map((h) => <th key={h} className="px-3 py-2 font-semibold">{h}</th>)}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {rows.map((c) => {
                    const client = clientsById.get(c.primary_client_id);
                    const kycId = c.kyc_edr_case_id || data.kycByCase[c.id];
                    const score = data.maxScore[c.id];
                    return (
                      <tr key={c.id} className="hover:bg-muted/30 cursor-pointer" onClick={() => navigate(`/tm/case/${c.id}`)}>
                        <td className="px-3 py-2.5 font-medium">{c.case_ref || '—'}</td>
                        <td className="px-3 py-2.5">
                          {c.primary_client_id ? <Link to={`/client/${c.primary_client_id}?tab=overview`} onClick={(e) => e.stopPropagation()} className="text-primary hover:underline">{client?.full_name || 'Customer'}</Link> : '—'}
                        </td>
                        <td className="px-3 py-2.5 tabular-nums">{(c.alert_ids || []).length}</td>
                        <td className="px-3 py-2.5 tabular-nums">{score == null ? '—' : Math.round(score)}</td>
                        <td className="px-3 py-2.5 text-xs">{CASE_STATUS_LABEL[c.status] || c.status}</td>
                        <td className="px-3 py-2.5 text-xs">{c.assigned_to_user_id ? name(c.assigned_to_user_id) : '—'}</td>
                        <td className="px-3 py-2.5 text-xs">{c.four_eyes_user_id ? name(c.four_eyes_user_id) : '—'}</td>
                        <td className="px-3 py-2.5">{OPEN.includes(c.status) ? <DeadlineCell alert={{ due_at: c.due_at }} now={now} /> : <span className="text-xs text-muted-foreground">—</span>}</td>
                        <td className="px-3 py-2.5">
                          {kycId ? <Link to={`/case/${kycId}`} onClick={(e) => e.stopPropagation()} className="text-[11px] font-medium px-2 py-0.5 rounded-full border border-primary/30 bg-primary/10 text-primary hover:bg-primary/20">KYC case</Link> : <span className="text-xs text-muted-foreground">—</span>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
      </div>
    </AppShell>
  );
}
