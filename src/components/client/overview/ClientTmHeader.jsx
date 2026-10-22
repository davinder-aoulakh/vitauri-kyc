import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { useTenant } from '@/lib/tenantContext';
import RiskGauge from '@/components/client/monitoring/RiskGauge';
import StatusPills from '@/components/client/monitoring/StatusPills';

/** Header summary next to the client name: small risk gauge + status pills. Shares the Monitoring query cache. */
export default function ClientTmHeader({ client }) {
  const { currentUser } = useTenant();
  const { data } = useQuery({
    queryKey: ['client-monitoring', currentUser?.tenant_id, client.id],
    queryFn: async () => {
      const res = await base44.functions.invoke('getClientMonitoring', { client_id: client.id });
      return res?.data ?? res;
    },
  });
  if (!data) return null;
  return (
    <div className="flex flex-wrap items-center gap-3">
      <RiskGauge size="sm" risk={data.risk} />
      {data.pills && <StatusPills pills={data.pills} />}
    </div>
  );
}
