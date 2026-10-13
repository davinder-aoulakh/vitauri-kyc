import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useTenant } from '@/lib/tenantContext';
import { isFeatureEnabled } from '@/lib/featureFlags';
import { hasPermission } from '@/lib/permissions';
import { useTmCaseData, useCaseAction, useCaseUsers } from '@/hooks/useTmCase';
import { clockPill } from '@/lib/tmCase';
import AppShell from '@/components/layout/AppShell';
import EmptyState from '@/components/shared/EmptyState';
import InlineError from '@/components/shared/InlineError';
import CaseHeader from '@/components/tm/case/CaseHeader';
import FiuCtaBar from '@/components/tm/case/FiuCtaBar';
import EvidencePanel from '@/components/tm/case/EvidencePanel';
import BundledAlerts from '@/components/tm/case/BundledAlerts';
import CaseActionsPanel from '@/components/tm/case/CaseActionsPanel';
import DecisionsPanel from '@/components/tm/case/DecisionsPanel';
import CaseTimeline from '@/components/tm/case/CaseTimeline';
import { Loader2, Lock, FolderSearch } from 'lucide-react';

export default function TmCaseWorkspace() {
  const { id } = useParams();
  const { currentUser, tenant } = useTenant();
  const tenantId = currentUser?.tenant_id;
  const role = currentUser?.app_role;
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 60000); return () => clearInterval(t); }, []);

  const allowed = isFeatureEnabled(tenant, 'tm_core') && (hasPermission(role, 'tmWorkCase') || hasPermission(role, 'tmFourEyes'));
  const canWork = hasPermission(role, 'tmWorkCase');
  const isCO = hasPermission(role, 'tmApproveFiuReport');
  const { tmCase, alerts, scenarios, client, decisions, fiuReports } = useTmCaseData(tenantId, id, allowed);
  const { data: users = [] } = useCaseUsers(tenantId, allowed);
  const { run, busy } = useCaseAction(tenantId, id);

  if (!allowed) {
    return <AppShell><EmptyState icon={Lock} title="Not available" description="Cases need Transaction Monitoring to be enabled and the right permission." /></AppShell>;
  }
  if (tmCase.isLoading) return <AppShell><div className="flex justify-center py-20" role="status"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div></AppShell>;
  if (tmCase.error) return <AppShell><InlineError message="Couldn't load this case." onRetry={() => tmCase.refetch()} /></AppShell>;
  const c = tmCase.data;
  if (!c) return <AppShell><EmptyState icon={FolderSearch} title="Case not found" description="It may have been removed, or it belongs to another organisation." /></AppShell>;

  const alertList = alerts.data || [];
  const pill = clockPill(c, alertList[0]?.indicator_type, now);
  const fiuLocked = (fiuReports.data || []).some((r) => r.status !== 'rejected');

  return (
    <AppShell>
      <div className="max-w-7xl mx-auto px-4 md:px-6 py-6">
        <CaseHeader tmCase={c} users={users} client={client.data} pill={pill} />
        {isFeatureEnabled(tenant, 'tm_fiu') && canWork && <FiuCtaBar caseId={c.id} />}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          <div className="space-y-5">
            <EvidencePanel tmCase={c} canWork={canWork} run={run} busy={busy} />
          </div>
          <div className="space-y-5">
            <BundledAlerts tmCase={c} alerts={alertList} scenarios={scenarios.data || []} canWork={canWork} tenantId={tenantId} run={run} busy={busy} />
            <CaseActionsPanel tmCase={c} client={client.data} tenant={tenant} tenantId={tenantId} canWork={canWork} fiuLocked={fiuLocked} run={run} busy={busy} />
            <DecisionsPanel tmCase={c} decisions={decisions.data || []} users={users} currentUserId={currentUser?.id} canWork={canWork} isCO={isCO} run={run} busy={busy} />
          </div>
        </div>
        <CaseTimeline timeline={c.timeline} canWork={canWork} run={run} busy={busy} />
      </div>
    </AppShell>
  );
}