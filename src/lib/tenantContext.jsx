import React, { createContext, useContext, useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { resolveLang } from '@/lib/i18n';

const TenantContext = createContext(null);

export function TenantProvider({ children }) {
  const [currentUser, setCurrentUser] = useState(null);
  const [tenant, setTenant] = useState(null);
  const [loading, setLoading] = useState(true);
  // opsTenantId: when Vitauri Ops is viewing a tenant in read-only context
  const [opsTenantId, setOpsTenantId] = useState(null);
  const [opsTenant, setOpsTenant] = useState(null);

  useEffect(() => {
    async function init() {
      try {
        const user = await base44.auth.me();
        // Ensure app_role and tenant_id are accessible at top level
        // (invited users may have these nested under user.data)
        if (user && !user.app_role && user.data?.app_role) {
          user.app_role = user.data.app_role;
        }
        if (user && !user.tenant_id && user.data?.tenant_id) {
          user.tenant_id = user.data.tenant_id;
        }
        setCurrentUser(user);

        if (user?.tenant_id) {
          const tenants = await base44.entities.Tenant.filter({ id: user.tenant_id });
          if (tenants?.length > 0) setTenant(tenants[0]);
        }
      } catch (e) {
        // not authenticated
      } finally {
        setLoading(false);
      }
    }
    init();
  }, []);

  // When Vitauri Ops selects a tenant to view, load it
  useEffect(() => {
    loadOpsTenant();
  }, [opsTenantId]);

  async function loadOpsTenant() {
    if (!opsTenantId) { setOpsTenant(null); return; }
    const tenants = await base44.entities.Tenant.filter({ id: opsTenantId });
    setOpsTenant(tenants?.[0] || null);
  }

  async function refreshOpsTenant() {
    await loadOpsTenant();
  }

  // The effective tenant to use throughout the app:
  // If Vitauri Ops is viewing a tenant → use that tenant; otherwise use own tenant
  const effectiveTenant = opsTenantId ? opsTenant : tenant;
  const isOpsViewing = !!opsTenantId && currentUser?.app_role === 'Vitauri Ops';

  const lang = resolveLang(currentUser, effectiveTenant);

  return (
    <TenantContext.Provider value={{
      currentUser, tenant: effectiveTenant, loading,
      setCurrentUser, setTenant,
      opsTenantId, setOpsTenantId,
      opsTenant, setOpsTenant, refreshOpsTenant, isOpsViewing,
      lang,
    }}>
      {children}
    </TenantContext.Provider>
  );
}

export function useTenant() {
  return useContext(TenantContext);
}