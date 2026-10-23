import React, { useMemo, useState } from 'react';
import { useTenant } from '@/lib/tenantContext';
import { useTenantClients } from '@/hooks/useTenantData';
import { useCoverageData } from '@/hooks/useCoverageData';
import { isFeatureEnabled } from '@/lib/featureFlags';
import { hasPermission } from '@/lib/permissions';
import { monthOptions } from '@/lib/tmCoverage';
import AppShell from '@/components/layout/AppShell';
import PageHeader from '@/components/shared/PageHeader';
import EmptyState from '@/components/shared/EmptyState';
import InlineError from '@/components/shared/InlineError';
import CoverageKpis from '@/components/tm/coverage/CoverageKpis';
import AccountsCoverageTable from '@/components/tm/coverage/AccountsCoverageTable';
import ConnectionsTable from '@/components/tm/coverage/ConnectionsTable';
import StatementUploadDrawer from '@/components/tm/StatementUploadDrawer';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Loader2, Lock, Upload } from 'lucide-react';

export default function TmCoverage() {
  const { currentUser, tenant } = useTenant();
  const tenantId = currentUser?.tenant_id;
  const months = useMemo(() => monthOptions(12), []);
  const [month, setMonth] = useState(months[0].value);
  const [showUpload, setShowUpload] = useState(false);

  const allowed = isFeatureEnabled(tenant, 'tm_core') && hasPermission(currentUser?.app_role, 'tmViewAlerts');
  const canUpload = hasPermission(currentUser?.app_role, 'tmWorkCase');
  const { data: clients } = useTenantClients(tenantId, { enabled: allowed });
  const { data, isLoading, error, refetch, isFetching } = useCoverageData(tenantId, month, clients, allowed);
  const monthLabel = months.find((m) => m.value === month)?.label;

  if (!allowed) {
    return (
      <AppShell>
        <EmptyState icon={Lock} title="Not available" description="Data coverage needs Transaction Monitoring to be enabled and the right permission." />
      </AppShell>
    );
  }

  return (
    <AppShell>
      <PageHeader
        title="Is all transaction data in and reviewed?"
        subtitle="Coverage per bank account and day, connection health and review backlog."
        actions={
          <>
            <Select value={month} onValueChange={setMonth}>
              <SelectTrigger className="h-9 w-44 text-sm" aria-label="Month"><SelectValue /></SelectTrigger>
              <SelectContent>
                {months.map((m) => <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>)}
              </SelectContent>
            </Select>
            {canUpload && (
              <Button size="sm" className="gap-1.5 text-xs" onClick={() => setShowUpload(true)}>
                <Upload className="w-3.5 h-3.5" /> Upload statement
              </Button>
            )}
          </>
        }
      />

      {error && <InlineError message="Couldn't load coverage data." onRetry={() => refetch()} />}
      {isLoading && (
        <div className="flex justify-center py-16" role="status"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>
      )}
      {data && (
        <div className={isFetching ? 'space-y-5 opacity-70 transition-opacity' : 'space-y-5 transition-opacity'}>
          <CoverageKpis kpis={data.kpis} monthLabel={monthLabel} lifecycle={data.lifecycle} />
          <AccountsCoverageTable rows={data.accountRows} start={data.start} end={data.end} />
          <ConnectionsTable rows={data.accountRows} />
        </div>
      )}

      {canUpload && (
        <StatementUploadDrawer open={showUpload} onOpenChange={setShowUpload} clients={clients || []} onCommitted={() => refetch()} />
      )}
    </AppShell>
  );
}