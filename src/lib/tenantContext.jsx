import React, { createContext, useContext, useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';

const TenantContext = createContext(null);

export function TenantProvider({ children }) {
  const [currentUser, setCurrentUser] = useState(null);
  const [tenant, setTenant] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function init() {
      try {
        const user = await base44.auth.me();
        setCurrentUser(user);

        // Load tenant if user has one
        if (user?.tenant_id) {
          const tenants = await base44.entities.Tenant.filter({ id: user.tenant_id });
          if (tenants?.length > 0) {
            setTenant(tenants[0]);
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

  return (
    <TenantContext.Provider value={{ currentUser, tenant, loading, setCurrentUser, setTenant }}>
      {children}
    </TenantContext.Provider>
  );
}

export function useTenant() {
  return useContext(TenantContext);
}