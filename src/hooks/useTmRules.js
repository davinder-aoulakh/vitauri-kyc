import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { useToast } from '@/components/ui/use-toast';
import { errorMessage } from '@/lib/tmAlerts';

/** Rules, mode counts, scenarios and risks for the tenant. Every query is tenant-scoped; rules refresh in realtime. */
export function useTmRulesData(tenantId, enabled) {
  const qc = useQueryClient();
  const on = !!tenantId && enabled;
  const rules = useQuery({
    queryKey: ['tmRules', tenantId, 'list'], enabled: on,
    queryFn: async () => (await base44.entities.TmRule.filter({ tenant_id: tenantId }, { sort: '-created_date', limit: 300 })).items || [],
  });
  const active = useQuery({
    queryKey: ['tmRules', tenantId, 'count', 'active'], enabled: on,
    queryFn: () => base44.entities.TmRule.count({ tenant_id: tenantId, mode: 'active' }),
  });
  const test = useQuery({
    queryKey: ['tmRules', tenantId, 'count', 'test'], enabled: on,
    queryFn: () => base44.entities.TmRule.count({ tenant_id: tenantId, mode: 'test' }),
  });
  const scenarios = useQuery({
    queryKey: ['tmScenarios', tenantId], enabled: on, staleTime: 60000,
    queryFn: async () => (await base44.entities.TmScenario.filter({ tenant_id: tenantId }, { sort: 'code', limit: 200 })).items || [],
  });
  const risks = useQuery({
    queryKey: ['tmRisks', tenantId], enabled: on, staleTime: 60000,
    queryFn: async () => (await base44.entities.TmRisk.filter({ tenant_id: tenantId }, { limit: 200 })).items || [],
  });

  useEffect(() => {
    if (!on) return undefined;
    let timer;
    const unsub = base44.entities.TmRule.subscribe(() => {
      clearTimeout(timer);
      timer = setTimeout(() => qc.invalidateQueries({ queryKey: ['tmRules', tenantId] }), 400);
    });
    return () => { clearTimeout(timer); unsub?.(); };
  }, [on, tenantId, qc]);

  return { rules, active, test, scenarios, risks };
}

/** Latest backtest of one rule version (RuleBacktest). */
export function useRuleBacktest(tenantId, ruleId, enabled = true) {
  return useQuery({
    queryKey: ['tmRules', tenantId, 'backtest', ruleId], enabled: !!tenantId && !!ruleId && enabled,
    queryFn: async () => (await base44.entities.RuleBacktest.filter({ tenant_id: tenantId, rule_id: ruleId }, { sort: '-created_date', limit: 1 })).items?.[0] || null,
  });
}

/** call(functionName, payload, successMessage) -> response data, or null after showing the error. */
export function useRuleCall(tenantId) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [busy, setBusy] = useState('');
  const call = async (fn, payload, success) => {
    setBusy(payload.action || fn);
    try {
      const res = await base44.functions.invoke(fn, payload);
      await qc.invalidateQueries({ queryKey: ['tmRules', tenantId] });
      if (success) toast({ title: success });
      (res?.data?.warnings || []).forEach((w) => toast({ title: 'Heads up', description: w, variant: 'destructive' }));
      return res?.data || {};
    } catch (e) {
      qc.invalidateQueries({ queryKey: ['tmRules', tenantId] });
      toast({ title: 'Action failed', description: errorMessage(e), variant: 'destructive' });
      return null;
    } finally {
      setBusy('');
    }
  };
  return { call, busy };
}