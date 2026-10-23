import React from 'react';
import { useTenant } from '@/lib/tenantContext';
import { isFeatureEnabled } from '@/lib/featureFlags';
import { hasPermission } from '@/lib/permissions';
import AppShell from '@/components/layout/AppShell';
import PageHeader from '@/components/shared/PageHeader';
import EmptyState from '@/components/shared/EmptyState';
import TmMiTab from '@/components/mi/TmMiTab';
import { Lock } from 'lucide-react';

/** Transaction monitoring MI as its own page (also still available as a tab on the MI dashboard). */
export default function TmMi() {
  const { currentUser, tenant } = useTenant();
  const allowed = isFeatureEnabled(tenant, 'tm_core') && hasPermission(currentUser?.app_role, 'viewMIDashboard');
  if (!allowed) {
    return <AppShell><EmptyState icon={Lock} title="Not available" description="Monitoring MI needs Transaction Monitoring and the MI permission." /></AppShell>;
  }
  return (
    <AppShell>
      <div className="max-w-7xl mx-auto px-4 md:px-6 py-6">
        <PageHeader title="Reports & MI" subtitle="Alerts, false positives, handling time, deadlines and FIU reports" />
        <TmMiTab tenantId={currentUser?.tenant_id} />
      </div>
    </AppShell>
  );
}
