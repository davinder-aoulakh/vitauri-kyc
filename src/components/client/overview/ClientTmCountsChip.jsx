import React from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { useTenant } from '@/lib/tenantContext';
import { OPEN_STATUSES } from '@/lib/tmAlerts';
import { toClientView } from '@/lib/routes';
import { Activity, Ban } from 'lucide-react';
import { cn } from '@/lib/utils';

/** Shared query: open TM alerts and Didit-blocked transactions for one client (tenant-scoped). */
export function useClientTmCounts(clientId, enabled = true) {
  const { currentUser } = useTenant();
  const tenantId = currentUser?.tenant_id;
  return useQuery({
    queryKey: ['client-tm-counts', tenantId, clientId],
    enabled: enabled && !!tenantId && !!clientId,
    staleTime: 60000,
    queryFn: async () => {
      const safe = (p) => p.then((n) => (typeof n === 'number' ? n : Number(n?.count ?? n) || 0)).catch(() => 0);
      const [openAlerts, blocked] = await Promise.all([
        safe(base44.entities.TmAlert.count({ tenant_id: tenantId, client_id: clientId, status: { $in: OPEN_STATUSES } })),
        safe(base44.entities.Transaction.count({ tenant_id: tenantId, client_id: clientId, blocked: true })),
      ]);
      return { openAlerts, blocked };
    },
  });
}

/** "TM: N open alerts · M blocked" — links to the client's Alerts & cases / Transactions views. */
export default function ClientTmCountsChip({ clientId, className }) {
  const { data } = useClientTmCounts(clientId);
  if (!data) return null;
  const { openAlerts, blocked } = data;
  return (
    <span className={cn('inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-medium',
      blocked > 0 ? 'border-red-200 bg-red-50 text-red-800' : openAlerts > 0 ? 'border-amber-200 bg-amber-50 text-amber-900' : 'border-border bg-muted text-muted-foreground',
      className)}>
      <Activity className="h-3 w-3" aria-hidden="true" />
      <span>TM:</span>
      <Link to={toClientView(clientId, 'work')} className="hover:underline">{openAlerts} open alert{openAlerts === 1 ? '' : 's'}</Link>
      <span aria-hidden="true">·</span>
      <Link to={toClientView(clientId, 'transactions')} className="inline-flex items-center gap-1 hover:underline">
        {blocked > 0 && <Ban className="h-3 w-3" aria-hidden="true" />}{blocked} blocked
      </Link>
    </span>
  );
}
