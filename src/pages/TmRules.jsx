import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useTenant } from '@/lib/tenantContext';
import { isFeatureEnabled } from '@/lib/featureFlags';
import { hasPermission } from '@/lib/permissions';
import { useTmRulesData, useRuleCall } from '@/hooks/useTmRules';
import { useCaseUsers } from '@/hooks/useTmCase';
import { groupLineages, lineageKey } from '@/lib/tmRules';
import AppShell from '@/components/layout/AppShell';
import PageHeader from '@/components/shared/PageHeader';
import EmptyState from '@/components/shared/EmptyState';
import InlineError from '@/components/shared/InlineError';
import RulesList from '@/components/tm/rules/RulesList';
import RuleEditor from '@/components/tm/rules/RuleEditor';
import DraftPanel from '@/components/tm/rules/DraftPanel';
import LibraryDialog from '@/components/tm/rules/LibraryDialog';
import { Button } from '@/components/ui/button';
import { Loader2, Lock, ListChecks, Plus } from 'lucide-react';

export default function TmRules() {
  const { currentUser, tenant } = useTenant();
  const tenantId = currentUser?.tenant_id;
  const role = currentUser?.app_role;
  const canManage = hasPermission(role, 'tmManageRules');
  const canApprove = hasPermission(role, 'tmApproveRules');
  const allowed = isFeatureEnabled(tenant, 'tm_rules') && (canManage || canApprove);

  const { rules, active, test, scenarios, risks } = useTmRulesData(tenantId, allowed);
  const { data: users = [] } = useCaseUsers(tenantId, allowed);
  const { call, busy } = useRuleCall(tenantId);
  const [selectedId, setSelectedId] = useState(null);
  const [library, setLibrary] = useState(null);
  const [fromScenario, setFromScenario] = useState(null);
  const seeded = useRef(false);

  const list = rules.data || [];
  const lineages = useMemo(() => groupLineages(list), [list]);
  const scenarioList = scenarios.data || [];
  const scenariosById = useMemo(() => new Map(scenarioList.map((s) => [s.id, s])), [scenarioList]);
  const usersById = useMemo(() => new Map(users.map((u) => [u.id, u])), [users]);
  const selected = list.find((r) => r.id === selectedId) || null;
  const versions = selected ? lineages.find((l) => l.key === lineageKey(selected))?.versions || [selected] : [];

  const seed = () => call('tmRuleAction', { action: 'seed_starters' }, null).then((r) => r?.created?.length && setSelectedId(null));
  useEffect(() => {
    // First use: create the four inactive starter drafts once (idempotent on the server).
    if (seeded.current || !canManage || rules.isLoading || rules.error || scenarios.isLoading || list.length > 0 || scenarioList.length === 0) return;
    seeded.current = true;
    seed();
  }, [canManage, rules.isLoading, rules.error, scenarios.isLoading, list.length, scenarioList.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const draft = async (text) => {
    const res = await call('draftRuleFromText', { text, scenario_id: fromScenario?.id }, 'Draft created');
    if (res?.rule_id) { setSelectedId(res.rule_id); setFromScenario(null); }
  };
  const pick = (s) => { setLibrary(null); setSelectedId(null); setFromScenario(s); };

  if (!allowed) {
    return <AppShell><EmptyState icon={Lock} title="Not available" description="Rules need the TM rule builder to be enabled and the right permission." /></AppShell>;
  }

  return (
    <AppShell>
      <div className="max-w-7xl mx-auto px-4 md:px-6 py-6">
        <PageHeader
          title={`Rules · ${active.data ?? '…'} active · ${test.data ?? '…'} in test · synced with Didit via Management API`}
          subtitle="Rules are authored and versioned here and run in Didit. Nothing is switched on without a second approver."
          actions={canManage && (
            <>
              <Button size="sm" variant="outline" className="text-xs" onClick={() => setLibrary('CW')}>Library: Curaçao objective indicators</Button>
              <Button size="sm" variant="outline" className="text-xs" onClick={() => setLibrary('NL')}>Library: Wwft indicators</Button>
              <Button size="sm" className="gap-1.5 text-xs" onClick={() => { setSelectedId(null); setFromScenario(null); }}><Plus className="w-3.5 h-3.5" /> New rule</Button>
            </>
          )}
        />
        {rules.error && <InlineError message="Couldn't load rules." onRetry={() => rules.refetch()} />}
        {(rules.isLoading || busy === 'seed_starters') && <div className="flex justify-center py-10" role="status"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>}
        {!rules.isLoading && !rules.error && lineages.length === 0 && busy !== 'seed_starters' && (
          <EmptyState icon={ListChecks} title="No rules yet" description="Create four inactive starter drafts from the scenario library, or describe a rule below."
            action={canManage && scenarioList.length > 0 ? <Button size="sm" onClick={seed}>Create starter drafts</Button> : undefined} />
        )}
        {lineages.length > 0 && <RulesList lineages={lineages} scenariosById={scenariosById} usersById={usersById} selectedId={selected?.id} onSelect={(id) => { setSelectedId(id); setFromScenario(null); }} />}

        {canManage && !selected && (
          <DraftPanel scenario={fromScenario} busy={busy}
            initialText={fromScenario ? `Detect: ${fromScenario.name}${fromScenario.description ? `. ${fromScenario.description.replace(/\s*Indicator codes must be.*$/, '')}` : ''}` : ''}
            onSubmit={draft} />
        )}
        {selected && (
          <RuleEditor tenantId={tenantId} rule={selected} versions={versions} scenarios={scenarioList} risks={risks.data || []} users={users}
            canManage={canManage} canApprove={canApprove} userId={currentUser?.id} call={call} busy={busy} onSelect={setSelectedId} onSaved={setSelectedId} />
        )}
        <LibraryDialog code={library} scenarios={scenarioList} onOpenChange={(v) => !v && setLibrary(null)} onPick={pick} />
      </div>
    </AppShell>
  );
}