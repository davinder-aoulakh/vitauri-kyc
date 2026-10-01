// Shared react-query hooks for tenant-wide entity lists.
// Using a common query key per tenant means Users/Clients/Cases/etc. are
// fetched once and reused across pages instead of being re-fetched on every
// navigation — this is the main lever for cutting total request volume.
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';

const STALE_TIME = 60000; // 60s — navigating between pages within this window reuses the cache

export function useTenantUsers(tenantId, options = {}) {
  const { enabled = true } = options;
  return useQuery({
    queryKey: ['users', tenantId],
    queryFn: () => base44.entities.User.filter({ tenant_id: tenantId }).catch(() => []),
    enabled: !!tenantId && enabled,
    staleTime: STALE_TIME,
  });
}

export function useTenantClients(tenantId, options = {}) {
  const { enabled = true } = options;
  return useQuery({
    queryKey: ['clients', tenantId],
    queryFn: () => base44.entities.Client.filter({ tenant_id: tenantId }, '-created_date', 1000),
    enabled: !!tenantId && enabled,
    staleTime: STALE_TIME,
  });
}

export function useTenantCases(tenantId, options = {}) {
  const { enabled = true } = options;
  return useQuery({
    queryKey: ['cases', tenantId],
    queryFn: () => base44.entities.KycCase.filter({ tenant_id: tenantId }, '-created_date', 1000),
    enabled: !!tenantId && enabled,
    staleTime: STALE_TIME,
  });
}

export function useTenantScreeningHits(tenantId, options = {}) {
  const { enabled = true } = options;
  return useQuery({
    queryKey: ['screeningHits', tenantId],
    queryFn: () => base44.entities.ScreeningHit.filter({ tenant_id: tenantId }, '-created_date', 500),
    enabled: !!tenantId && enabled,
    staleTime: STALE_TIME,
  });
}

export function useTenantControlMeasures(tenantId, options = {}) {
  const { enabled = true } = options;
  return useQuery({
    queryKey: ['controlMeasures', tenantId],
    queryFn: () => base44.entities.ControlMeasure.filter({ tenant_id: tenantId }, '-created_date', 1000),
    enabled: !!tenantId && enabled,
    staleTime: STALE_TIME,
  });
}

export function useTenantAuditEvents(tenantId, options = {}) {
  const { enabled = true, limit = 20 } = options;
  return useQuery({
    queryKey: ['auditEvents', tenantId, limit],
    queryFn: () => base44.entities.AuditEvent.filter({ tenant_id: tenantId }, '-created_date', limit),
    enabled: !!tenantId && enabled,
    staleTime: STALE_TIME,
  });
}