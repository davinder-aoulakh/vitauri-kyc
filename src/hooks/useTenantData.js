// Shared react-query hooks for tenant-wide entity lists.
// Using a common query key per tenant means Users/Clients/Cases/etc. are
// fetched once and reused across pages instead of being re-fetched on every
// navigation — this is the main lever for cutting total request volume.
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';

const STALE_TIME = 60000; // 60s — navigating between pages within this window reuses the cache

/**
 * The tenant's users via the listTenantUsers function (service role, tenant-scoped, sanitised).
 * Reading the built-in User entity from the browser does not reliably return colleagues, which left
 * analyst names blank on All Cases. Falls back to the direct read only if the function fails.
 */
export async function fetchTenantUsers(tenantId) {
  let users;
  try {
    users = (await base44.functions.invoke('listTenantUsers', {}))?.data?.users;
  } catch {
    users = null;
  }
  if (!Array.isArray(users)) {
    const res = await base44.entities.User.filter({ tenant_id: tenantId }).catch(() => []);
    users = Array.isArray(res) ? res : res?.items || [];
  }
  return users
    .filter((u) => !tenantId || !u.tenant_id || u.tenant_id === tenantId)
    .map((u) => ({ ...u, full_name: u.full_name || u.email || 'Unnamed user' }));
}

export function useTenantUsers(tenantId, options = {}) {
  const { enabled = true } = options;
  return useQuery({
    queryKey: ['users', tenantId],
    queryFn: () => fetchTenantUsers(tenantId),
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