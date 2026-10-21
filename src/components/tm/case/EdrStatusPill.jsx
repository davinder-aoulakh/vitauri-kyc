import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { useTenant } from '@/lib/tenantContext';
import { isFeatureEnabled } from '@/lib/featureFlags';
import { cn } from '@/lib/utils';

function pillFor(status) {
  if (status === 'Draft') return { label: 'Draft', cls: 'bg-muted text-muted-foreground' };
  if (status === 'Approved') return { label: 'Approved', cls: 'bg-emerald-100 text-emerald-700' };
  if (status === 'Rejected') return { label: 'Rejected', cls: 'bg-red-100 text-red-700' };
  return { label: 'In progress', cls: 'bg-blue-100 text-blue-700' };
}

export default function EdrStatusPill({ kycCaseId }) {
  const { tenant } = useTenant();
  const on = isFeatureEnabled(tenant, 'tm_core');
  const { data } = useQuery({
    queryKey: ['edr-status', kycCaseId],
    enabled: on && !!kycCaseId,
    queryFn: async () => (await base44.entities.KycCase.filter({ id: kycCaseId }, undefined, 1))[0] || null,
  });
  if (!on || !data) return null;
  const p = pillFor(data.status);
  return <span className={cn('text-[11px] font-semibold px-2 py-0.5 rounded-full', p.cls)}>{p.label}</span>;
}