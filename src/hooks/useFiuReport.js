import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { useToast } from '@/components/ui/use-toast';
import { errorMessage } from '@/lib/tmAlerts';

const first = (page) => page?.items?.[0] || null;

/** Report workspace data. Every query is tenant-scoped; the report refreshes in realtime. */
export function useFiuReportData(tenantId, id, enabled) {
  const qc = useQueryClient();
  const on = !!tenantId && !!id && enabled;
  const key = (name, extra) => ['fiuReport', tenantId, id, name, ...(extra ? [extra] : [])];

  const report = useQuery({
    queryKey: key('report'), enabled: on,
    queryFn: async () => first(await base44.entities.FiuReport.filter({ tenant_id: tenantId, id }, { limit: 1 })),
  });
  const r = report.data;
  const fiu = useQuery({
    queryKey: key('fiu', r?.fiu_profile_code), enabled: on && !!r,
    queryFn: async () => first(await base44.entities.FiuProfile.filter({ tenant_id: tenantId, code: r.fiu_profile_code }, { limit: 1 })),
  });
  const checks = useQuery({
    queryKey: key('checks', `${r?.status}:${r?.updated_date}`), enabled: on && !!r && ['draft', 'in_review'].includes(r.status),
    queryFn: async () => (await base44.functions.invoke('fiuReportAction', { action: 'checks', report_id: id }))?.data?.checks || [],
  });

  useEffect(() => {
    if (!on) return undefined;
    let timer;
    const unsub = base44.entities.FiuReport.subscribe((event) => {
      if (event?.id !== id) return;
      clearTimeout(timer);
      timer = setTimeout(() => qc.invalidateQueries({ queryKey: ['fiuReport', tenantId, id] }), 400);
    });
    return () => { clearTimeout(timer); unsub?.(); };
  }, [on, tenantId, id, qc]);

  return { report, fiu, checks };
}

/** act(functionName, payload, successMessage) -> response data, or null after showing the error. */
export function useFiuAct(tenantId, id) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [busy, setBusy] = useState('');
  const act = async (fn, payload, success) => {
    setBusy(payload.action || fn);
    try {
      const res = await base44.functions.invoke(fn, { report_id: id, ...payload });
      await qc.invalidateQueries({ queryKey: ['fiuReport', tenantId, id] });
      if (success) toast({ title: success });
      return res?.data || {};
    } catch (e) {
      qc.invalidateQueries({ queryKey: ['fiuReport', tenantId, id] });
      toast({ title: 'Action failed', description: errorMessage(e), variant: 'destructive' });
      return null;
    } finally {
      setBusy('');
    }
  };
  return { act, busy };
}

/** Opens a private file through a short-lived signed link. */
export async function openFile(id, kind, toast) {
  try {
    const res = await base44.functions.invoke('fiuReportAction', { action: 'signed_url', report_id: id, kind });
    window.open(res?.data?.signed_url, '_blank', 'noopener');
  } catch (e) {
    toast({ title: 'Could not open the file', description: errorMessage(e), variant: 'destructive' });
  }
}