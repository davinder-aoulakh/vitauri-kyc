// Route helpers for the KYC + AML layout (flag aml_nav_v2 with tm_core). With the layout off, the old page shows.
import React from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useTenant } from '@/lib/tenantContext';
import { amlLayoutOn } from '@/lib/amlNav';

/** Shows `v2` when the KYC + AML layout is on, otherwise `legacy`. Waits for the tenant so no wrong page flashes. */
export function LayoutSwitch({ v2, legacy }) {
  const { tenant, loading } = useTenant();
  if (loading && !tenant) return null;
  return amlLayoutOn(tenant) ? v2 : legacy;
}

/** With the layout on, an old route moves to its new place (`to`, optional `tab`); other query parameters are kept. */
export function V2Redirect({ to, tab, legacy }) {
  const { search } = useLocation();
  const params = new URLSearchParams(search);
  if (tab) params.set('tab', tab);
  const qs = params.toString();
  return <LayoutSwitch v2={<Navigate to={`${to}${qs ? `?${qs}` : ''}`} replace />} legacy={legacy} />;
}
