import React from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { useTenant } from '@/lib/tenantContext';
import { isFeatureEnabled } from '@/lib/featureFlags';
import { hasPermission } from '@/lib/permissions';
import InlineError from '@/components/shared/InlineError';
import FxMissingBadge from '@/components/shared/FxMissingBadge';
import BankAccountsCard from '@/components/client/bankaccounts/BankAccountsCard';
import CounterpartiesCard from '@/components/client/monitoring/CounterpartiesCard';
import ExpectedProfileCard from '@/components/tm/ExpectedProfileCard';
import RiskGauge from './monitoring/RiskGauge';
import StatusPills from './monitoring/StatusPills';
import ProfileKvStrip from './monitoring/ProfileKvStrip';
import InboundChart from './monitoring/InboundChart';
import AiSummaryBox from './monitoring/AiSummaryBox';
import MonitoringTimeline from './monitoring/MonitoringTimeline';
import MonitoringActions from './monitoring/MonitoringActions';
import OpenItemsStrip from './overview/OpenItemsStrip';
import ReportsCard from './overview/ReportsCard';
import { useCustomerFile } from './overview/useCustomerFile';
import OwnershipControlCard from './monitoring/OwnershipControlCard';
import { Loader2 } from 'lucide-react';

// Roles that may read FiuArtefact (entity RLS read list).
const FIU_ARTEFACT_READERS = ['Analyst', 'QC Reviewer', 'Compliance Officer', 'Manager', 'Director', 'Compliance Admin', 'Tenant Admin'];

/** Client "Overview" tab (formerly Monitoring): open items, reports, dynamic risk, profile vs actual, chart, AI summary and timeline. Needs tm_core + createRunCase. */
export default function MonitoringTab({ client }) {
  const { currentUser, tenant } = useTenant();
  const qc = useQueryClient();
  const enabled = isFeatureEnabled(tenant, 'tm_core') && hasPermission(currentUser?.app_role, 'createRunCase');
  const key = ['client-monitoring', currentUser?.tenant_id, client.id];

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: key,
    enabled,
    queryFn: async () => {
      const res = await base44.functions.invoke('getClientMonitoring', { client_id: client.id });
      return res?.data ?? res;
    },
  });

  const { data: file } = useCustomerFile(client.id, enabled);
  const showFiu = isFeatureEnabled(tenant, 'tm_fiu');
  const canReadArtefacts = showFiu && FIU_ARTEFACT_READERS.includes(currentUser?.app_role);

  if (!enabled) return null;
  if (isLoading) return <div className="flex justify-center py-12"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>;
  if (error || !data) return <InlineError message={error?.response?.data?.error || 'Could not load monitoring data.'} onRetry={refetch} />;

  const refresh = () => qc.invalidateQueries({ queryKey: key });

  return (
    <div className="space-y-4">
      {file && <OpenItemsStrip file={file} clientId={client.id} showFiu={showFiu} />}
      {file && canReadArtefacts && <ReportsCard reports={file.fiu_reports || []} artefacts={file.fiu_artefacts || []} />}
      {file && client.client_type === 'ORG' && <OwnershipControlCard client={client} relatedParties={file.related_parties || []} />}
      <div className="flex flex-col gap-4 rounded-xl border border-border bg-card p-4 lg:flex-row lg:items-center lg:justify-between">
        <RiskGauge risk={data.risk} />
        <div className="space-y-3 lg:max-w-[55%]">
          <StatusPills pills={data.pills} clientType={client.client_type} />
          <MonitoringActions client={client} currentUser={currentUser} data={data} onChanged={refresh} />
        </div>
      </div>
      {data.fx_missing > 0 && <FxMissingBadge count={data.fx_missing} />}
      <ProfileKvStrip data={data} />
      <BankAccountsCard client={client} />
      <CounterpartiesCard client={client} />
      <InboundChart monthly={data.monthly} ceiling={data.profile?.inbound_max_month ?? null} currency={data.reporting_currency} />
      <div className="grid gap-4 lg:grid-cols-2">
        <ExpectedProfileCard client={client} onChanged={refresh} />
        <AiSummaryBox clientId={client.id} />
      </div>
      <MonitoringTimeline items={file?.timeline || []} />
    </div>
  );
}