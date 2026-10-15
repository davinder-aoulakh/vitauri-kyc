import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { useToast } from '@/components/ui/use-toast';
import { errorMessage } from '@/lib/tmAlerts';

const page = async (entity, query, sort, limit) => (await entity.filter(query, { sort, limit })).items || [];

/** Risks, scenarios, rules, backtests and samples of the tenant. Every query is tenant-scoped; samples refresh in realtime. */
export function useTmQualityData(tenantId, enabled) {
  const qc = useQueryClient();
  const on = !!tenantId && enabled;
  const q = (key, fn, extra = {}) => useQuery({ queryKey: ['tmQuality', tenantId, key], enabled: on, queryFn: fn, ...extra }); // eslint-disable-line react-hooks/rules-of-hooks
  const risks = q('risks', () => page(base44.entities.TmRisk, { tenant_id: tenantId }, 'code', 200), { staleTime: 60000 });
  const scenarios = q('scenarios', () => page(base44.entities.TmScenario, { tenant_id: tenantId }, 'code', 300));
  const rules = q('rules', () => page(base44.entities.TmRule, { tenant_id: tenantId }, '-created_date', 500), { staleTime: 30000 });
  const backtests = q('backtests', () => page(base44.entities.RuleBacktest, { tenant_id: tenantId }, '-created_date', 500), { staleTime: 30000 });
  const samples = q('samples', () => page(base44.entities.QualitySample, { tenant_id: tenantId }, '-created_date', 100));

  useEffect(() => {
    if (!on) return undefined;
    let timer;
    const unsub = base44.entities.QualitySample.subscribe(() => {
      clearTimeout(timer);
      timer = setTimeout(() => qc.invalidateQueries({ queryKey: ['tmQuality', tenantId, 'samples'] }), 400);
    });
    return () => { clearTimeout(timer); unsub?.(); };
  }, [on, tenantId, qc]);
  return { risks, scenarios, rules, backtests, samples };
}

/** call(fn, payload, successMessage) -> response data, or null after showing the error. */
export function useQualityCall(tenantId) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [busy, setBusy] = useState('');
  const call = async (fn, payload, success, key = fn) => {
    setBusy(key);
    try {
      const res = await base44.functions.invoke(fn, payload);
      await qc.invalidateQueries({ queryKey: ['tmQuality', tenantId] });
      if (success) toast({ title: success });
      return res?.data || {};
    } catch (e) {
      toast({ title: 'Action failed', description: errorMessage(e), variant: 'destructive' });
      return null;
    } finally {
      setBusy('');
    }
  };
  return { call, busy };
}