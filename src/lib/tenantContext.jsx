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
        } else if (user?.email && user?.app_role !== 'Vitauri Ops') {
          // Auto-link: check if this user was invited as a pending tenant admin
          const matchedTenants = await base44.asServiceRole.entities.Tenant.filter({
            pending_admin_email: user.email.toLowerCase(),
          }).catch(() => []);

          if (matchedTenants?.length > 0) {
            const matchedTenant = matchedTenants[0];
            // Link the user to the tenant and grant Tenant Admin role
            await base44.auth.updateMe({
              tenant_id: matchedTenant.id,
              app_role: 'Tenant Admin',
            });
            // Clear the pending slot on the tenant
            await base44.asServiceRole.entities.Tenant.update(matchedTenant.id, {
              pending_admin_email: '',
            });
            // Re-fetch user and tenant to reflect the new state
            const updatedUser = await base44.auth.me();
            if (updatedUser && !updatedUser.app_role && updatedUser.data?.app_role) updatedUser.app_role = updatedUser.data.app_role;
            if (updatedUser && !updatedUser.tenant_id && updatedUser.data?.tenant_id) updatedUser.tenant_id = updatedUser.data.tenant_id;
            setCurrentUser(updatedUser);
            setTenant(matchedTenant);
          }
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
    async function loadOpsTenant() {
      if (!opsTenantId) { setOpsTenant(null); return; }
      const tenants = await base44.entities.Tenant.filter({ id: opsTenantId });
      setOpsTenant(tenants?.[0] || null);
    }
    loadOpsTenant();
  }, [opsTenantId]);

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
      opsTenant, isOpsViewing,
      lang,
    }}>
      {children}
    </TenantContext.Provider>
  );
}

export function useTenant() {
  return useContext(TenantContext);
}