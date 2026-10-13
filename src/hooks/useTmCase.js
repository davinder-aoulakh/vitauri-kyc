import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { useToast } from '@/components/ui/use-toast';
import { errorMessage } from '@/lib/tmAlerts';

const first = (page) => page?.items?.[0] || null;

/** Tenant users (id, name, role) via the existing listTenantUsers function. */
export function useCaseUsers(tenantId, enabled = true) {
  return useQuery({
    queryKey: ['tmCaseUsers', tenantId],
    enabled: !!tenantId && enabled,
    staleTime: 60000,
    queryFn: async () => (await base44.functions.invoke('listTenantUsers', {}))?.data?.users || [],
  });
}

/** All data for the case workspace. Every query is tenant-scoped and refreshed in realtime via TmCase.subscribe. */
export function useTmCaseData(tenantId, id, enabled) {
  const qc = useQueryClient();
  const on = !!tenantId && !!id && enabled;
  const key = (name, extra) => ['tmCaseData', tenantId, id, name, ...(extra ? [extra] : [])];

  const tmCase = useQuery({
    queryKey: key('case'), enabled: on,
    queryFn: async () => first(await base44.entities.TmCase.filter({ tenant_id: tenantId, id }, { limit: 1 })),
  });
  const c = tmCase.data;
  const alertKey = (c?.alert_ids || []).join(',');

  const alerts = useQuery({
    queryKey: key('alerts', alertKey), enabled: on && !!c && (c.alert_ids || []).length > 0,
    queryFn: async () => (await base44.entities.TmAlert.filter({ tenant_id: tenantId, id: { $in: c.alert_ids } }, { limit: 100 })).items || [],
  });
  const scenarioIds = [...new Set((alerts.data || []).map((a) => a.scenario_id).filter(Boolean))];
  const scenarios = useQuery({
    queryKey: key('scenarios', scenarioIds.join(',')), enabled: on && scenarioIds.length > 0,
    queryFn: async () => (await base44.entities.TmScenario.filter({ tenant_id: tenantId, id: { $in: scenarioIds } }, { limit: 100 })).items || [],
  });
  const client = useQuery({
    queryKey: key('client', c?.primary_client_id), enabled: on && !!c?.primary_client_id,
    queryFn: async () => first(await base44.entities.Client.filter({ tenant_id: tenantId, id: c.primary_client_id }, { limit: 1 })),
  });
  const decisions = useQuery({
    queryKey: key('decisions'), enabled: on,
    queryFn: async () => (await base44.entities.Decision.filter({ tenant_id: tenantId, subject_type: 'case', subject_id: id }, { sort: '-decided_at', limit: 50 })).items || [],
  });
  const fiuReports = useQuery({
    queryKey: key('fiu'), enabled: on,
    queryFn: async () => (await base44.entities.FiuReport.filter({ tenant_id: tenantId, tm_case_id: id }, { limit: 20 })).items || [],
  });

  useEffect(() => {
    if (!on) return undefined;
    let timer;
    const unsub = base44.entities.TmCase.subscribe((event) => {
      if (event?.id !== id) return;
      clearTimeout(timer);
      timer = setTimeout(() => qc.invalidateQueries({ queryKey: ['tmCaseData', tenantId, id] }), 400);
    });
    return () => { clearTimeout(timer); unsub?.(); };
  }, [on, tenantId, id, qc]);

  return { tmCase, alerts, scenarios, client, decisions, fiuReports };
}

/** run(action, payload, {success}) -> response data, or null after showing the error. */
export function useCaseAction(tenantId, id) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [busy, setBusy] = useState('');
  const run = async (action, payload = {}, opts = {}) => {
    setBusy(action);
    try {
      const res = await base44.functions.invoke('manageTmCase', { action, tm_case_id: id, ...payload });
      qc.invalidateQueries({ queryKey: ['tmCaseData', tenantId, id] });
      if (opts.success) toast({ title: opts.success });
      return res?.data || {};
    } catch (e) {
      toast({ title: opts.fail || 'Action failed', description: errorMessage(e), variant: 'destructive' });
      return null;
    } finally {
      setBusy('');
    }
  };
  return { run, busy };
}