// Sidebar for the KYC + AML layout (flag aml_nav_v2, build spec section 2 and decision D1). Data only: AppShell adds
// the icons and applies the same permission / feature checks it uses for the other two sidebars.
// No route moves in this phase: every href is an existing page.
export { librariesFor, libraryCodesFor, normaliseJurisdictions } from '../../base44/shared/tmLibraryScope.js';

/** Which sidebar to show: 'legacy' (tm_core off), 'tm' (tm_core on) or 'aml' (tm_core and aml_nav_v2 on). */
export function selectNav({ tmCore, amlNavV2 }) {
  if (!tmCore) return 'legacy';
  return amlNavV2 ? 'aml' : 'tm';
}

export const amlNavItems = [
  {
    group: 'OVERVIEW',
    items: [
      { label: 'My Work', icon: 'Inbox', href: '/work', permission: null, badge: 'myWork' },
      { label: 'KYC Dashboard', icon: 'LayoutDashboard', href: '/', permission: null, featureKey: 'dashboard' },
      { label: 'AML Dashboard', icon: 'PieChart', href: '/tm/mi', permission: 'viewMIDashboard', featureKey: 'tm_core' },
    ],
  },
  {
    group: 'CUSTOMERS',
    items: [
      { label: 'New Client', icon: 'Users', href: '/new-client', permission: 'createEditClient', featureKey: 'new_client' },
      { label: 'Client Search', icon: 'Search', href: '/client-search', permission: null, featureKey: 'client_search' },
    ],
  },
  {
    group: 'KYC',
    items: [
      { label: 'My Reviews', icon: 'FolderOpen', href: '/my-cases', permission: null, featureKey: 'my_cases' },
      { label: 'Reviews', icon: 'FolderOpen', href: '/all-cases', permission: 'viewAllTenantCases', featureKey: 'all_cases' },
      { label: 'Screening', icon: 'Shield', href: '/monitoring', permission: null, badge: 'alerts', featureKey: 'monitoring' },
      { label: 'Review Planner', icon: 'Calendar', href: '/review-planner', permission: 'viewAllTenantCases', featureKey: 'review_planner' },
      // Outreach keeps its own role gate (OUTREACH_ROLES) and feature flag
      { label: 'New Outreach', icon: 'Send', href: '/outreach/new', permission: null, featureKey: 'outreach', outreachOnly: true },
      { label: 'Outreach Dashboard', icon: 'Mail', href: '/outreach-dashboard', permission: null, badge: 'outreach', featureKey: 'outreach', outreachOnly: true },
    ],
  },
  {
    group: 'AML',
    items: [
      { label: 'Alerts', icon: 'AlertTriangle', href: '/tm/alerts', permission: 'tmViewAlerts', badge: 'tmAlerts', featureKey: 'tm_core' },
      { label: 'Investigations', icon: 'Briefcase', href: '/tm/cases', permission: 'tmViewAlerts', badge: 'tmCases', featureKey: 'tm_core' },
      { label: 'Transactions', icon: 'Activity', href: '/transaction-monitoring', permission: null, featureKey: 'transaction_monitoring' },
    ],
  },
  {
    group: 'REPORTING',
    items: [
      { label: 'FIU Reports', icon: 'FileText', href: '/tm/reports', permission: 'createRunCase', badge: 'fiu', featureKey: 'tm_fiu' },
      { label: 'MI Dashboard', icon: 'BarChart3', href: '/mi-dashboard', permission: 'viewMIDashboard', featureKey: 'mi_dashboard' },
      { label: 'Risk Dashboard', icon: 'Shield', href: '/risk-dashboard', permission: 'viewMIDashboard', featureKey: 'mi_dashboard' },
    ],
  },
  {
    group: 'ADMIN',
    items: [
      { label: 'Audit Log', icon: 'ClipboardList', href: '/audit-logs', permission: 'tenantConfig', featureKey: 'audit_logs' },
      { label: 'Tenant Config', icon: 'Settings', href: '/tenant-config', permission: 'tenantConfig', featureKey: 'tenant_config' },
      { label: 'Users', icon: 'UserCircle', href: '/user-management', permission: 'userManagement', featureKey: 'user_management' },
      { label: 'Archive', icon: 'Archive', href: '/archive', permission: 'viewArchive', featureKey: 'archive' },
      // These three move into Tenant Config and the AML Dashboard in phase 9; until then they stay reachable here.
      { label: 'Rules', icon: 'SlidersHorizontal', href: '/tm/rules', anyPermission: ['tmManageRules', 'tmApproveRules'], featureKey: 'tm_rules' },
      { label: 'Data Coverage', icon: 'Activity', href: '/tm/coverage', permission: 'tmViewAlerts', featureKey: 'tm_core' },
      { label: 'Quality', icon: 'ShieldCheck', href: '/tm/quality', permission: 'tmQuality', featureKey: 'tm_quality' },
    ],
  },
];

// ── Customer file tabs (flag on) ──
// The five tabs of spec section 2, then the existing ones (decision D1).
export const CLIENT_TABS_V2 = [
  { value: 'overview', label: 'Overview', monitoring: 'summary' },
  { value: 'accounts', label: 'Accounts & transactions', monitoring: 'transactions' },
  { value: 'expected-profile', label: 'Expected profile', monitoring: 'profile' },
  { value: 'cases', label: 'Reviews & changes' },
  { value: 'alerts', label: 'Alerts & investigations', monitoring: 'work' },
  { value: 'profile', label: 'Profile' },
  { value: 'related-parties', label: 'Related Parties' },
  { value: 'documents', label: 'Documents' },
  { value: 'audit-trail', label: 'Audit Trail' },
];

const VIEW_TO_TAB = { transactions: 'accounts', profile: 'expected-profile', work: 'alerts' };

/**
 * The tab to open for a URL (?tab=…&view=…). Links made before this layout keep working:
 * ?tab=overview&view=transactions → Accounts & transactions, and so on. Network and Timeline stay inside Overview.
 * Returns { tab, view } where view is the sub-view to show inside Overview (or null).
 */
export function clientTabFor(tab, view) {
  const t = tab === 'monitoring' ? 'overview' : tab;
  if (!t || t === 'overview') {
    if (VIEW_TO_TAB[view]) return { tab: VIEW_TO_TAB[view], view: null };
    return { tab: 'overview', view: ['network', 'timeline'].includes(view) ? view : null };
  }
  return { tab: CLIENT_TABS_V2.some((x) => x.value === t) ? t : 'overview', view: null };
}
