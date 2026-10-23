import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useTenant } from '@/lib/tenantContext';
import { isFeatureEnabled } from '@/lib/featureFlags';
import { useMyWork, WORK_KINDS, workItemRoute } from '@/hooks/useMyWork';
import { toClient } from '@/lib/routes';
import AppShell from '@/components/layout/AppShell';
import PageHeader from '@/components/shared/PageHeader';
import EmptyState from '@/components/shared/EmptyState';
import InlineError from '@/components/shared/InlineError';
import DeadlineChip from '@/components/tm/kit/DeadlineChip';
import StatusPill from '@/components/tm/kit/StatusPill';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import {
  AlertTriangle, Briefcase, FolderOpen, Zap, LineChart, FileText, MailOpen, Loader2, Lock, CheckCircle2, RefreshCw,
} from 'lucide-react';

const ICON = { alert: AlertTriangle, tm_case: Briefcase, kyc_case: FolderOpen, edr: Zap, profile: LineChart, fiu_report: FileText, outreach: MailOpen };
const TONE = {
  alert: 'text-amber-600', tm_case: 'text-primary', kyc_case: 'text-sky-600', edr: 'text-violet-600',
  profile: 'text-teal-600', fiu_report: 'text-purple-600', outreach: 'text-emerald-600',
};
const DAY = 86400000;
const FILTERS = [{ key: 'all', label: 'All' }, { key: 'due', label: 'Due < 24 h' }, ...WORK_KINDS];

/** One queue for everything that needs the signed-in user: TM and KYC, sorted by deadline. j/k to move, Enter to open. */
export default function MyWork() {
  const { currentUser, tenant } = useTenant();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const tmOn = isFeatureEnabled(tenant, 'tm_core');
  const { data, isLoading, error, refetch, isFetching } = useMyWork(currentUser?.tenant_id, tmOn);
  const filter = FILTERS.some((f) => f.key === searchParams.get('section')) ? searchParams.get('section') : 'all';
  const [active, setActive] = useState(0);
  const rowRefs = useRef([]);
  const now = Date.now();

  const items = data?.items || [];
  const counts = useMemo(() => {
    const c = { all: items.length, due: items.filter((i) => i.due_at && new Date(i.due_at).getTime() < now + DAY).length };
    for (const k of WORK_KINDS) c[k.key] = items.filter((i) => i.kind === k.key).length;
    return c;
  }, [items, now]);
  const shown = useMemo(() => items.filter((i) => (filter === 'all' ? true
    : filter === 'due' ? i.due_at && new Date(i.due_at).getTime() < now + DAY : i.kind === filter)), [items, filter, now]);

  useEffect(() => { setActive(0); }, [filter]);
  useEffect(() => {
    const onKey = (e) => {
      if (e.target.closest('input, textarea, [contenteditable="true"], [role="dialog"]')) return;
      if (e.key === 'j' || e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(a + 1, shown.length - 1)); }
      if (e.key === 'k' || e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
      if (e.key === 'Enter' && shown[active]) { const to = workItemRoute(shown[active]); if (to) navigate(to); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [shown, active, navigate]);
  useEffect(() => { rowRefs.current[active]?.scrollIntoView({ block: 'nearest' }); }, [active]);

  if (!tmOn) {
    return <AppShell><EmptyState icon={Lock} title="Not available" description="My work needs Transaction Monitoring to be enabled." /></AppShell>;
  }

  return (
    <AppShell>
      <div className="max-w-6xl mx-auto px-4 md:px-6 py-6">
        <PageHeader
          title="My work"
          subtitle={data ? `${counts.due} due within 24 hours · ${counts.all} open item${counts.all === 1 ? '' : 's'} · sorted by deadline` : 'Everything that needs you, across KYC and transaction monitoring'}
          actions={(
            <Button size="sm" variant="outline" className="gap-1.5 text-xs" onClick={() => refetch()} disabled={isFetching}>
              {isFetching ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />} Refresh
            </Button>
          )}
        />

        <div role="tablist" aria-label="Filter work" className="flex flex-wrap gap-1.5 mb-4">
          {FILTERS.map((f) => (
            <button
              key={f.key} type="button" role="tab" aria-selected={filter === f.key}
              onClick={() => setSearchParams(f.key === 'all' ? {} : { section: f.key })}
              className={cn('px-3 py-1.5 rounded-full text-xs font-medium border transition-colors',
                filter === f.key ? 'bg-primary text-primary-foreground border-primary' : 'bg-card text-muted-foreground border-border hover:text-foreground')}
            >
              {f.label}{data ? <span className="ml-1.5 tabular-nums opacity-80">{counts[f.key] ?? 0}</span> : null}
            </button>
          ))}
        </div>

        {error && <InlineError message="Couldn't load your work." onRetry={() => refetch()} />}
        {isLoading && <div className="flex justify-center py-16" role="status"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>}
        {data && shown.length === 0 && (
          <EmptyState
            icon={CheckCircle2}
            title={filter === 'all' ? 'You are all caught up' : 'Nothing here'}
            description={filter === 'all' ? 'New alerts, cases, approvals and customer replies appear here as soon as they need you.' : 'Nothing in this section needs you right now.'}
          />
        )}

        {shown.length > 0 && (
          <ul className="bg-card border border-border rounded-xl divide-y divide-border overflow-hidden" aria-label="Work items">
            {shown.map((item, i) => {
              const Icon = ICON[item.kind] || FolderOpen;
              const to = workItemRoute(item);
              return (
                <li key={`${item.kind}-${item.id}`} ref={(el) => { rowRefs.current[i] = el; }}>
                  <div
                    role="button" tabIndex={0} aria-current={i === active ? 'true' : undefined}
                    onClick={() => to && navigate(to)} onKeyDown={(e) => { if (e.key === 'Enter' && to) navigate(to); }}
                    onMouseEnter={() => setActive(i)}
                    className={cn('flex items-center gap-3 px-4 py-3 cursor-pointer transition-colors outline-none focus-visible:ring-2 focus-visible:ring-primary/40',
                      i === active ? 'bg-secondary/70' : 'hover:bg-secondary/40')}
                  >
                    <Icon className={cn('w-4 h-4 flex-shrink-0', TONE[item.kind])} aria-hidden />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 min-w-0">
                        {item.ref && <span className="font-mono text-[11px] text-muted-foreground flex-shrink-0">{item.ref}</span>}
                        <span className="text-sm font-medium text-foreground truncate">{item.title}</span>
                      </div>
                      <div className="text-xs text-muted-foreground truncate">
                        {item.client_id && <Link to={toClient(item.client_id)} onClick={(e) => e.stopPropagation()} className="text-primary hover:underline">{item.client_name}</Link>}
                        {item.client_id && item.subtitle ? ' · ' : ''}{item.subtitle}
                      </div>
                    </div>
                    <div className="hidden sm:block flex-shrink-0"><StatusPill status={item.status} /></div>
                    <div className="flex-shrink-0 w-44 flex justify-end">
                      {item.due_at ? <DeadlineChip dueAt={item.due_at} /> : <span className="text-xs text-muted-foreground">No deadline</span>}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        {shown.length > 0 && <p className="text-[11px] text-muted-foreground mt-3">Keyboard: j / k to move, Enter to open.</p>}
      </div>
    </AppShell>
  );
}
