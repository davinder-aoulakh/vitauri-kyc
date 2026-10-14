import React from 'react';
import { useRuleBacktest } from '@/hooks/useTmRules';
import { ModeBadge, SyncBadge, ApprovalBadge } from '@/components/tm/rules/RuleBadges';
import RuleJsonPanel from '@/components/tm/rules/RuleJsonPanel';
import CoverageTable from '@/components/tm/rules/CoverageTable';
import BacktestPanel from '@/components/tm/rules/BacktestPanel';
import GovernanceForm from '@/components/tm/rules/GovernanceForm';
import RuleActionsBar from '@/components/tm/rules/RuleActionsBar';
import VersionHistory from '@/components/tm/rules/VersionHistory';
import { isRetired } from '@/lib/tmRules';

/** Editor for one rule version. `call` is the shared function caller from useRuleCall. */
export default function RuleEditor({ tenantId, rule, versions, scenarios, risks, users, canManage, canApprove, userId, call, busy, onSelect, onSaved }) {
  const { data: backtest } = useRuleBacktest(tenantId, rule.id);
  const scenario = scenarios.find((s) => s.id === rule.scenario_id);
  const risk = risks.find((r) => r.id === scenario?.risk_id);
  const owner = users.find((u) => u.id === rule.owner_user_id);
  const canEdit = canManage && !isRetired(rule);

  const act = async (action, extra = {}) => {
    const res = await call('tmRuleAction', { action, rule_id: rule.id, ...extra }, {
      request_approval: 'Sent for approval', approve: 'Rule approved', reject: 'Sent back', set_mode: 'Mode updated', retire: 'Rule retired',
    }[action]);
    return !!res;
  };
  const save = async (extra, definition = rule.definition) => {
    const res = await call('tmRuleAction', { action: 'save', rule_id: rule.id, definition, ...extra }, 'Saved');
    if (res?.new_version) onSaved(res.rule_id);
    return !!res;
  };
  const resync = (force) => {
    if (force && !window.confirm('Replace the Didit version with the Vitauri version? Changes made in the Didit console will be lost.')) return null;
    return call('syncDiditRule', { rule_id: rule.id, force }, 'Synced with Didit');
  };
  const run = (days) => call('backtestRule', { rule_id: rule.id, window_from: new Date(Date.now() - days * 86400000).toISOString(), window_to: new Date().toISOString() }, 'Backtest finished');

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <h2 className="text-base font-semibold mr-2">{rule.name} · v{rule.version || 1}</h2>
        <ModeBadge mode={rule.mode} /><ApprovalBadge status={rule.approval_status} /><SyncBadge rule={rule} />
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <RuleJsonPanel rule={rule} canEdit={canEdit} busy={busy} onSave={(def) => save({}, def)} />
        <section className="bg-card border border-border rounded-xl p-4">
          <h2 className="text-sm font-semibold mb-2">Coverage and backtest</h2>
          <CoverageTable rule={rule} scenario={scenario} risk={risk} owner={owner} />
          <GovernanceForm rule={rule} scenarios={scenarios} users={users} canEdit={canEdit} busy={busy} onSave={(f) => save(f)} />
          <BacktestPanel backtest={backtest} canRun={canEdit} busy={busy} onRun={run} />
        </section>
      </div>
      <RuleActionsBar rule={rule} backtest={backtest} canManage={canManage} canApprove={canApprove} busy={busy}
        isMaker={!!userId && (userId === rule.created_by_user_id || userId === rule.requested_by_user_id)} onAct={act} onResync={resync} />
      <VersionHistory versions={versions} selectedId={rule.id} onSelect={onSelect} />
    </div>
  );
}