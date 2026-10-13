import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { buildAlertQuery, sortAlerts } from '@/lib/tmAlerts';

/** Tenant-scoped open alerts for a filter pill + open count, refreshed in realtime via TmAlert.subscribe. */
export function useTmAlerts(tenantId, userId, filter, enabled) {
  const qc = useQueryClient();

  const list = useQuery({
    queryKey: ['tmAlerts', tenantId, filter, userId],
    enabled: !!tenantId && enabled,
    queryFn: async () => {
      const page = await base44.entities.TmAlert.filter(buildAlertQuery(filter, tenantId, userId), { sort: '-score', limit: 200 });
      return sortAlerts(page.items || []);
    },
  });

  const count = useQuery({
    queryKey: ['tmAlertsOpenCount', tenantId],
    enabled: !!tenantId && enabled,
    queryFn: () => base44.entities.TmAlert.count(buildAlertQuery('all', tenantId, userId)),
  });

  useEffect(() => {
    if (!tenantId || !enabled) return undefined;
    let timer;
    const unsubscribe = base44.entities.TmAlert.subscribe((event) => {
      if (event?.data?.tenant_id && event.data.tenant_id !== tenantId) return;
      clearTimeout(timer);
      timer = setTimeout(() => {
        qc.invalidateQueries({ queryKey: ['tmAlerts', tenantId] });
        qc.invalidateQueries({ queryKey: ['tmAlertsOpenCount', tenantId] });
      }, 600);
    });
    return () => { clearTimeout(timer); unsubscribe?.(); };
  }, [tenantId, enabled, qc]);

  return { list, count };
}