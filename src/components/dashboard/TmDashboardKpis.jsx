import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { useTenant } from '@/lib/tenantContext';
import { isFeatureEnabled } from '@/lib/featureFlags';
import { hasPermission } from '@/lib/permissions';
import KpiCard from '@/components/shared/KpiCard';
import { AlertTriangle, Gavel, FileText, Zap } from 'lucide-react';

/** TM KPI row for the dashboard. Renders nothing unless tm_core is on and the user has tmViewAlerts. */
export default function TmDashboardKpis() {
  const { currentUser, tenant } = useTenant();
  const navigate = useNavigate();
  const show = isFeatureEnabled(tenant, 'tm_core') && hasPermission(currentUser?.app_role, 'tmViewAlerts');
  const fiuOn = isFeatureEnabled(tenant, 'tm_fiu') && hasPermission(currentUser?.app_role, 'createRunCase');

  const { data, isLoading } = useQuery({
    queryKey: ['tmDashboardCounts', currentUser?.tenant_id],
    enabled: show && !!currentUser?.tenant_id,
    staleTime: 60000,
    retry: false,
    queryFn: async () => (await base44.functions.invoke('tmDashboardCounts', {}))?.data,
  });
  if (!show) return null;
  const v = (k) => (isLoading ? '…' : data?.[k] ?? '—');

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
      <KpiCard label="TM alerts due < 24 h" value={v('alerts_due_24h')} icon={AlertTriangle} accent="bg-destructive" onClick={() => navigate('/tm/alerts?filter=soon')} />
      <KpiCard label="Pending CO decisions" value={v('pending_co')} icon={Gavel} accent="bg-warning" onClick={() => navigate('/tm/cases?filter=pending_co')} />
      {fiuOn && <KpiCard label="FIU reports awaiting submission" value={v('fiu_awaiting_submission')} icon={FileText} accent="bg-primary" onClick={() => navigate('/tm/reports?status=generated')} />}
      <KpiCard label="EDR proposals" value={v('edr_proposals')} icon={Zap} accent="bg-primary" subtitle="Accept or dismiss" onClick={() => navigate('/review-planner?filter=edr')} />
    </div>
  );
}
