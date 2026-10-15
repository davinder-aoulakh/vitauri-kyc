import React, { useState } from 'react';
import { useTenant } from '@/lib/tenantContext';
import { isFeatureEnabled } from '@/lib/featureFlags';
import { hasPermission } from '@/lib/permissions';
import CounterpartyDrawer from '@/components/tm/counterparty/CounterpartyDrawer';

/** Shows children as plain text, or as a link that opens the counterparty drawer (tm_core + tmViewAlerts, and an id). */
export default function CounterpartyLink({ id, children, className = '' }) {
  const { currentUser, tenant } = useTenant();
  const [open, setOpen] = useState(false);
  const allowed = !!id && isFeatureEnabled(tenant, 'tm_core') && hasPermission(currentUser?.app_role, 'tmViewAlerts');
  if (!allowed) return <span className={className}>{children}</span>;
  return (
    <>
      <button type="button" onClick={(e) => { e.stopPropagation(); setOpen(true); }} className={`text-primary hover:underline text-left ${className}`}>{children}</button>
      {open && <CounterpartyDrawer counterpartyId={id} open onOpenChange={setOpen} />}
    </>
  );
}