import React from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { base44 } from '@/api/base44Client';
import { useTenant } from '@/lib/tenantContext';
import { isFeatureEnabled } from '@/lib/featureFlags';
import { hasPermission } from '@/lib/permissions';
import InlineError from '@/components/shared/InlineError';
import FxMissingBadge from '@/components/shared/FxMissingBadge';
import RiskBadge from '@/components/shared/RiskBadge';
import BankAccountsCard from '@/components/client/bankaccounts/BankAccountsCard';
import CounterpartiesCard from '@/components/client/monitoring/CounterpartiesCard';
import ExpectedProfileCard from '@/components/tm/ExpectedProfileCard';
import TmTransactionList from '@/components/transactions/TmTransactionList';
import TransactionDetailPanel from '@/components/transactions/TransactionDetailPanel';
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
import RiskBreakdown from './c360/RiskBreakdown';
import AlertsCasesView from './c360/AlertsCasesView';
import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

// Roles that may read FiuArtefact (entity RLS read list).
const FIU_ARTEFACT_READERS = ['Analyst', 'QC Reviewer', 'Compliance Officer', 'Manager', 'Director', 'Compliance Admin', 'Tenant Admin'];
const RANK = { Low: 0, Medium: 1, High: 2, Unacceptable: 3 };

const VIEWS = [
  { key: 'summary', label: 'Overview' },
  { key: 'transactions', label: 'Transactions' },
  { key: 'profile', label: 'Profile & risk' },
  { key: 'work', label: 'Alerts & cases' },
  { key: 'network', label: 'Network' },
  { key: 'timeline', label: 'Timeline' },
];

/**
 * Customer 360 ("Overview" tab): a sticky header band (dynamic risk next to the KYC rating, verification and screening,
 * actions) and sub-views for transactions, profile & risk, alerts & cases, network and the full timeline.
 * Needs tm_core + createRunCase. ?view= deep-links a sub-view.
 */
export default function MonitoringTab({ client }) {
  const { currentUser, tenant } = useTenant();
  const qc = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const enabled = isFeatureEnabled(tenant, 'tm_core') && hasPermission(currentUser?.app_role, 'createRunCase');
  const key = ['client-monitoring', currentUser?.tenant_id, client.id];
  const isOrg = client.client_type === 'ORG';
  const view = VIEWS.some((v) => v.key === searchParams.get('view')) ? searchParams.get('view') : 'summary';
  const setView = (v) => {
    const next = new URLSearchParams(searchParams);
    next.set('tab', 'overview');
    if (v === 'summary') next.delete('view'); else next.set('view', v);
    setSearchParams(next, { replace: true });
  };
  const [selectedTxn, setSelectedTxn] = React.useState(null);

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
  const lastKyc = (file?.decisions || []).filter((d) => d.decision_type === 'kyc_approval' && d.outcome === 'approved' && d.decided_at)
    .sort((a, b) => String(b.decided_at).localeCompare(String(a.decided_at)))[0];
  const diverges = data.risk?.band && client.risk_classification && RANK[data.risk.band] > RANK[client.risk_classification];

  return (
    <div className="space-y-4">
      {/* Header band: stays in view while switching sub-views. */}
      <div className="sticky top-0 z-10 -mx-1 px-1 pt-1 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
        <div className="flex flex-col gap-4 rounded-xl border border-border bg-card p-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-center gap-5">
            <RiskGauge risk={data.risk} />
            <div className="space-y-1.5 text-xs">
              <div className="flex items-center gap-2"><span className="text-muted-foreground w-24">KYC rating</span><RiskBadge risk={client.risk_classification} /></div>
              <div className="flex items-center gap-2"><span className="text-muted-foreground w-24">KYC approved</span><span className="font-medium">{lastKyc ? format(new Date(lastKyc.decided_at), 'd MMM yyyy') : '—'}</span></div>
              {diverges && <div className="rounded-md bg-amber-50 px-2 py-1 text-amber-900 dark:bg-amber-500/10 dark:text-amber-100">Monitoring ({data.risk.band}) is above the KYC rating</div>}
            </div>
          </div>
          <div className="space-y-3 lg:max-w-[55%]">
            <StatusPills pills={data.pills} clientType={client.client_type} />
            <MonitoringActions client={client} currentUser={currentUser} data={data} onChanged={refresh} />
          </div>
        </div>
        <div role="tablist" aria-label="Customer views" className="mt-3 flex flex-wrap gap-1 border-b border-border">
          {VIEWS.map((v) => (
            <button
              key={v.key} type="button" role="tab" aria-selected={view === v.key} onClick={() => setView(v.key)}
              className={cn('px-3 py-2 text-sm -mb-px border-b-2 transition-colors',
                view === v.key ? 'border-primary text-foreground font-medium' : 'border-transparent text-muted-foreground hover:text-foreground')}
            >
              {v.label}
            </button>
          ))}
        </div>
      </div>

      {view === 'summary' && (
        <div className="space-y-4">
          {file && <OpenItemsStrip file={file} clientId={client.id} showFiu={showFiu} />}
          {data.fx_missing > 0 && <FxMissingBadge count={data.fx_missing} />}
          <ProfileKvStrip data={data} />
          <div className="grid gap-4 xl:grid-cols-5">
            <div className="xl:col-span-3"><InboundChart monthly={data.monthly} ceiling={data.profile?.inbound_max_month ?? null} currency={data.reporting_currency} /></div>
            <div className="xl:col-span-2"><AiSummaryBox clientId={client.id} /></div>
          </div>
          <MonitoringTimeline items={(file?.timeline || []).slice(0, 6)} />
          {(file?.timeline || []).length > 6 && (
            <button type="button" className="text-xs text-primary hover:underline" onClick={() => setView('timeline')}>Show the full timeline</button>
          )}
        </div>
      )}

      {view === 'transactions' && (
        <div className="space-y-4">
          <BankAccountsCard client={client} />
          <TmTransactionList tenantId={currentUser?.tenant_id} clients={[client]} fixedClientId={client.id} onSelect={setSelectedTxn} />
          {selectedTxn && (
            <TransactionDetailPanel
              transaction={selectedTxn} clientName={client.full_name} currentUser={currentUser} showCanonical
              onClose={() => setSelectedTxn(null)} onUpdated={refresh}
            />
          )}
        </div>
      )}

      {view === 'profile' && (
        <div className="space-y-4">
          <div className="rounded-xl border border-border bg-card p-4">
            <h3 className="text-sm font-semibold mb-3">Dynamic customer risk</h3>
            <RiskBreakdown risk={data.risk} kycRating={client.risk_classification} />
          </div>
          <ProfileKvStrip data={data} />
          <ExpectedProfileCard client={client} onChanged={refresh} />
        </div>
      )}

      {view === 'work' && (
        <div className="space-y-4">
          <AlertsCasesView file={file} showFiu={canReadArtefacts} />
          {file && canReadArtefacts && <ReportsCard reports={file.fiu_reports || []} artefacts={file.fiu_artefacts || []} />}
        </div>
      )}

      {view === 'network' && (
        <div className="space-y-4">
          {file && isOrg && <OwnershipControlCard client={client} relatedParties={file.related_parties || []} />}
          <CounterpartiesCard client={client} />
          {!isOrg && <p className="text-xs text-muted-foreground">Money-flow networks across customers (circular payments, shared beneficiaries) follow after the Didit validation test.</p>}
        </div>
      )}

      {view === 'timeline' && <MonitoringTimeline items={file?.timeline || []} />}
    </div>
  );
}
