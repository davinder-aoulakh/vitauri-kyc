import React, { useMemo, useState } from 'react';
import { useTenant } from '@/lib/tenantContext';
import { isFeatureEnabled } from '@/lib/featureFlags';
import { hasPermission } from '@/lib/permissions';
import { useTmQualityData, useQualityCall } from '@/hooks/useTmQuality';
import { useCaseUsers } from '@/hooks/useTmCase';
import { PERIODS, RELEASE_ROLES, DEFAULT_MAX_WRONGLY_CLOSED_PCT, periodRange, buildMatrix, latestShadowByScenario, inPeriod } from '@/lib/tmQuality';
import AppShell from '@/components/layout/AppShell';
import PageHeader from '@/components/shared/PageHeader';
import EmptyState from '@/components/shared/EmptyState';
import InlineError from '@/components/shared/InlineError';
import KpiCard from '@/components/shared/KpiCard';
import CoverageMatrix from '@/components/tm/quality/CoverageMatrix';
import SamplesPanel from '@/components/tm/quality/SamplesPanel';
import Worklist from '@/components/tm/quality/Worklist';
import ShadowTable from '@/components/tm/quality/ShadowTable';
import StartSampleDialog from '@/components/tm/quality/StartSampleDialog';
import ExportMenu from '@/components/tm/quality/ExportMenu';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Loader2, Lock } from 'lucide-react';

export default function TmQuality() {
  const { currentUser, tenant } = useTenant();
  const tenantId = currentUser?.tenant_id;
  const role = currentUser?.app_role;
  const allowed = isFeatureEnabled(tenant, 'tm_quality') && hasPermission(role, 'tmQuality');
  const canRelease = RELEASE_ROLES.includes(role);
  const maxPct = Number(tenant?.tm_settings?.max_wrongly_closed_pct ?? DEFAULT_MAX_WRONGLY_CLOSED_PCT);

  const { risks, scenarios, rules, backtests, samples } = useTmQualityData(tenantId, allowed);
  const { data: users = [] } = useCaseUsers(tenantId, allowed);
  const { call, busy } = useQualityCall(tenantId);
  const [days, setDays] = useState('90');
  const [starting, setStarting] = useState(null);
  const [selectedId, setSelectedId] = useState(null);
  const period = useMemo(() => periodRange(Number(days)), [days]);

  const scenarioList = scenarios.data || [];
  const sampleList = samples.data || [];
  const usersById = useMemo(() => new Map(users.map((u) => [u.id, u])), [users]);
  const matrix = useMemo(() => buildMatrix({ risks: risks.data || [], scenarios: scenarioList, rules: rules.data || [], backtests: backtests.data || [], samples: sampleList, usersById }),
    [risks.data, scenarioList, rules.data, backtests.data, sampleList, usersById]);
  const manual = sampleList.filter((s) => s.sample_type !== 'ai_shadow' && (s.status === 'open' || inPeriod(s.created_date, period.from, period.to)));
  const selected = manual.find((s) => s.id === selectedId) || manual.find((s) => s.status === 'open') || null;
  const latest = useMemo(() => latestShadowByScenario(sampleList), [sampleList]);
  const count = (st) => matrix.filter((r) => r.status === st).length;

  if (!allowed) {
    return <AppShell><EmptyState icon={Lock} title="Not available" description="Quality control needs the TM quality feature to be enabled and the right permission." /></AppShell>;
  }
  const loading = [risks, scenarios, rules, backtests, samples].some((q) => q.isLoading);
  const failed = [risks, scenarios, rules, backtests, samples].find((q) => q.error);

  const start = async (size) => {
    const res = await call('runQualitySample', { sample_type: starting, period_from: period.from, period_to: period.to, sample_size: size }, 'Sample created', 'start');
    if (res?.sample_id) { setStarting(null); setSelectedId(res.sample_id); }
  };
  const runShadow = async (scenarioId) => {
    await call('runQualitySample', { sample_type: 'ai_shadow', scenario_id: scenarioId, period_from: period.from, period_to: period.to }, 'AI shadow sample completed', `shadow:${scenarioId}`);
  };
  const release = (scenarioId, flag, value) => call('scenarioRelease', { scenario_id: scenarioId, flag, value }, value ? 'Scenario released' : 'Release withdrawn', 'release');
  const review = (refId, outcome, note, scenarioId) =>
    call('completeQualitySample', { action: 'review', sample_id: selected.id, ref_id: refId, outcome, note, scenario_id: scenarioId }, null, `review:${refId}`);

  return (
    <AppShell>
      <div className="max-w-7xl mx-auto px-4 md:px-6 py-6">
        <PageHeader
          title="Risk coverage and detection quality"
          subtitle="Independent checks that the monitoring covers the risks and that its decisions hold up."
          actions={(
            <>
              <Select value={days} onValueChange={setDays}>
                <SelectTrigger className="h-8 w-40 text-xs" aria-label="Period"><SelectValue /></SelectTrigger>
                <SelectContent>{PERIODS.map((p) => <SelectItem key={p.days} value={String(p.days)}>{p.label}</SelectItem>)}</SelectContent>
              </Select>
              <ExportMenu tenantId={tenantId} period={period} />
            </>
          )}
        />
        {failed && <InlineError message="Couldn't load quality data." onRetry={() => failed.refetch()} className="mb-4" />}
        {loading && <div className="flex justify-center py-10" role="status"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>}
        {!loading && (
          <>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
              <KpiCard label="Covered" value={count('Covered')} accent="bg-success" />
              <KpiCard label="Partial" value={count('Partial')} accent="bg-warning" />
              <KpiCard label="Gap" value={count('Gap')} accent="bg-destructive" />
              <KpiCard label="No data" value={count('No data')} accent="bg-muted-foreground" />
            </div>
            {matrix.length === 0
              ? <EmptyState title="No scenarios yet" description="Add scenarios from the library to see risk coverage." />
              : <CoverageMatrix rows={matrix} />}
            <div className="mt-5"><SamplesPanel samples={manual} selectedId={selected?.id} onSelect={setSelectedId} onStart={setStarting} /></div>
            {selected && (
              <Worklist sample={selected} userId={currentUser?.id} scenarios={scenarioList} busy={busy}
                onReview={review} onComplete={() => call('completeQualitySample', { action: 'complete', sample_id: selected.id }, 'Sample completed', 'complete')} />
            )}
            <ShadowTable scenarios={scenarioList} latest={latest} canRelease={canRelease} maxPct={maxPct} busy={busy} onRun={runShadow} onRelease={release} />
          </>
        )}
        <StartSampleDialog type={starting} period={period} busy={busy === 'start'} onOpenChange={(v) => !v && setStarting(null)} onStart={start} />
      </div>
    </AppShell>
  );
}