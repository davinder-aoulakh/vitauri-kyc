import React, { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useTenant } from '@/lib/tenantContext';
import { base44 } from '@/api/base44Client';
import { hasPermission, isVitauriOps } from '@/lib/permissions';
import { isFeatureEnabled } from '@/lib/featureFlags';
import OpsBanner from '@/components/layout/OpsBanner';
import SessionWatcher from '@/components/layout/SessionWatcher';
import ProfileFooterCard from '@/components/layout/ProfileFooterCard';
import AppLogo from '@/components/shared/AppLogo';
import {
  LayoutDashboard, FolderOpen, Users, Search, Shield,
  Settings, BarChart3, AlertTriangle, Calendar, Archive,
  ChevronLeft, ChevronRight, Menu, X,
  Building2, UserCircle, ClipboardList, ScanSearch, Mail, Send, Activity
} from 'lucide-react';
import { cn } from '@/lib/utils';

const navItems = [
  {
    group: 'OVERVIEW',
    items: [
      { label: 'Dashboard', icon: LayoutDashboard, href: '/', permission: null, featureKey: 'dashboard' },
      { label: 'My Cases', icon: FolderOpen, href: '/my-cases', permission: null, badge: 'myCases', featureKey: 'my_cases' },
      { label: 'All Cases', icon: FolderOpen, href: '/all-cases', permission: 'viewAllTenantCases', featureKey: 'all_cases' },
    ],
  },
  {
    group: 'CLIENTS',
    items: [
      { label: 'New Client', icon: Users, href: '/new-client', permission: 'createEditClient', featureKey: 'new_client' },
      { label: 'Client Search', icon: Search, href: '/client-search', permission: null, featureKey: 'client_search' },
    ],
  },
  {
    group: 'OUTREACH',
    outreachOnly: true,
    featureKey: 'outreach',
    items: [
      { label: 'New Outreach', icon: Send, href: '/outreach/new', permission: null },
      { label: 'Outreach Dashboard', icon: Mail, href: '/outreach-dashboard', permission: null, badge: 'outreach' },
    ],
  },
  {
    group: 'MONITORING',
    items: [
      { label: 'Screening', icon: Shield, href: '/monitoring', permission: null, badge: 'alerts', featureKey: 'monitoring' },
      { label: 'Transaction Monitoring', icon: Activity, href: '/transaction-monitoring', permission: null, featureKey: 'transaction_monitoring' },
      { label: 'Batch Screening', icon: ScanSearch, href: '/batch-screening', permission: 'createEditClient', featureKey: 'batch_screening' },
      { label: 'Review Planner', icon: Calendar, href: '/review-planner', permission: 'viewAllTenantCases', featureKey: 'review_planner' },
    ],
  },
  {
    group: 'REPORTS & ADMIN',
    items: [
      { label: 'MI Dashboard', icon: BarChart3, href: '/mi-dashboard', permission: 'viewMIDashboard', featureKey: 'mi_dashboard' },
      { label: 'Risk Dashboard', icon: Shield, href: '/risk-dashboard', permission: 'viewMIDashboard', featureKey: 'mi_dashboard' },
      { label: 'Audit Log', icon: ClipboardList, href: '/audit-logs', permission: 'tenantConfig', featureKey: 'audit_logs' },
      { label: 'Archive', icon: Archive, href: '/archive', permission: 'viewArchive', featureKey: 'archive' },
      { label: 'Tenant Config', icon: Settings, href: '/tenant-config', permission: 'tenantConfig', featureKey: 'tenant_config' },
      { label: 'User Management', icon: UserCircle, href: '/user-management', permission: 'userManagement', featureKey: 'user_management' },
    ],
  },
];

export default function AppShell({ children }) {
  const { currentUser, tenant } = useTenant();
  const location = useLocation();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  const { isOpsViewing, setOpsTenantId } = useTenant();
  const userRole = currentUser?.app_role;
  const OUTREACH_ROLES = ['Tenant Admin', 'Compliance Admin', 'Manager', 'Analyst'];
  const tenantColor = tenant?.branding_primary_color || '#1A6BFF';

  // Fetch outreach count for badge
  const { data: outreachCount = 0 } = useQuery({
    queryKey: ['outreachBadgeCount', currentUser?.tenant_id],
    queryFn: async () => {
      if (!currentUser?.tenant_id) return 0;
      const all = await base44.entities.OutreachRequest.filter({ tenant_id: currentUser.tenant_id }, '-created_date', 200);
      return (all || []).filter(r => r.status !== 'Complete').length;
    },
    // Fetch once per session — the central request throttler (base44Client.js) now
    // handles burst protection, so this no longer needs its own artificial delay
    staleTime: Infinity,
  });

  const isActive = (href) => {
    if (href === '/') return location.pathname === '/';
    return location.pathname.startsWith(href);
  };

  const SidebarContent = () => (
    <div className="flex flex-col h-full">
      {/* Logo */}
      <div className="flex items-center gap-3 px-4 py-5 border-b border-sidebar-border">
        <div className="flex-shrink-0">
          <AppLogo size={32} />
        </div>
        {!collapsed && (
          <div className="overflow-hidden">
            <div className="text-white font-semibold text-sm leading-tight">Vitauri KYC</div>
            <div className="text-sidebar-foreground/60 text-xs truncate">
              {tenant?.name || 'Loading...'}
            </div>
          </div>
        )}
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto py-4 px-2 space-y-5">
        {navItems.map((group) => {
          // Hide Outreach section for roles that are not allowed
          if (group.outreachOnly && !OUTREACH_ROLES.includes(userRole)) return null;
          // Hide entire group if its feature flag is disabled
          if (group.featureKey && !isFeatureEnabled(tenant, group.featureKey)) return null;

          const visibleItems = group.items.filter(item =>
            (!item.permission || hasPermission(userRole, item.permission)) &&
            (!item.featureKey || isFeatureEnabled(tenant, item.featureKey))
          );
          if (visibleItems.length === 0) return null;

          return (
            <div key={group.group}>
              {!collapsed && (
                <div className="px-2 mb-1.5 text-xs font-semibold text-sidebar-foreground/40 tracking-widest uppercase">
                  {group.group}
                </div>
              )}
              <div className="space-y-0.5">
                {visibleItems
                  // Hide write-only nav items when Ops is in read-only tenant context
                  .filter(item => {
                    if (!isOpsViewing) return true;
                    const writeOnly = ['/new-client'];
                    return !writeOnly.includes(item.href);
                  })
                  .map((item) => (
                  <Link
                    key={item.href}
                    to={item.href}
                    onClick={() => setMobileOpen(false)}
                    className={cn(
                      'flex items-center gap-3 px-2.5 py-2 rounded-md text-sm transition-colors group justify-between',
                      isActive(item.href)
                        ? 'bg-sidebar-accent text-sidebar-primary font-medium'
                        : 'text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-white'
                    )}
                  >
                    <div className="flex items-center gap-3 flex-1 min-w-0">
                      <item.icon className={cn('flex-shrink-0', collapsed ? 'w-5 h-5' : 'w-4 h-4')} />
                      {!collapsed && <span className="truncate">{item.label}</span>}
                    </div>
                    {item.badge === 'outreach' && outreachCount > 0 && !collapsed && (
                      <span className="ml-auto flex-shrink-0 px-2 py-0.5 bg-destructive/20 text-destructive text-xs font-semibold rounded-full">
                        {outreachCount}
                      </span>
                    )}
                  </Link>
                ))}
              </div>
            </div>
          );
        })}
      </nav>

      {/* User Footer */}
      <div className="border-t border-sidebar-border px-3 py-3 flex justify-center">
        <ProfileFooterCard currentUser={currentUser} collapsed={collapsed} />
      </div>
    </div>
  );

  return (
    <div className="flex flex-col h-screen bg-background overflow-hidden">
      <SessionWatcher />
      {isOpsViewing && (
        <OpsBanner
          tenantName={tenant?.name}
          onExit={() => { setOpsTenantId(null); window.location.href = '/ops'; }}
        />
      )}
    <div className="flex flex-1 overflow-hidden">
      {/* Desktop Sidebar */}
      <aside
        className={cn(
          'hidden md:flex flex-col bg-sidebar flex-shrink-0 transition-all duration-300 relative',
          collapsed ? 'w-14' : 'w-56'
        )}
      >
        <SidebarContent />
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="absolute -right-3 top-16 w-6 h-6 rounded-full bg-sidebar border-2 border-background flex items-center justify-center text-sidebar-foreground hover:bg-sidebar-accent transition-colors z-10"
        >
          {collapsed ? <ChevronRight className="w-3 h-3" /> : <ChevronLeft className="w-3 h-3" />}
        </button>
      </aside>

      {/* Mobile Sidebar Overlay */}
      {mobileOpen && (
        <div className="md:hidden fixed inset-0 z-50 flex">
          <div className="w-56 bg-sidebar flex flex-col">
            <SidebarContent />
          </div>
          <div className="flex-1 bg-black/50" onClick={() => setMobileOpen(false)} />
        </div>
      )}

      {/* Main Content */}
      <div className="flex-1 flex flex-col overflow-hidden relative">
        {/* Mobile-only menu trigger — sidebar header removed */}
        <button
          className="md:hidden absolute top-3 left-3 z-10 p-2 rounded-full bg-card/90 backdrop-blur-md border border-border shadow-sm text-foreground"
          onClick={() => setMobileOpen(true)}
        >
          <Menu className="w-5 h-5" />
        </button>

        {/* Page Content */}
        <main className="flex-1 overflow-auto">
          {children}
        </main>
      </div>
    </div>
    </div>
  );
}