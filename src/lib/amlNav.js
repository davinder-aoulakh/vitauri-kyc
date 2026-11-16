// Sidebar for the KYC + AML layout (flag aml_nav_v2, build spec section 2 and decision D1). Data only: AppShell adds
// the icons and applies the same permission / feature checks it uses for the other two sidebars.
// No route moves in this phase: every href is an existing page.
// `domain` ('kyc' | 'aml') on a group or item: hidden for users who work on the other side only (phase 6).
import { isFeatureEnabled } from './featureFlags.js';
import { hasPermission, canAml } from './permissions.js';

export { librariesFor, libraryCodesFor, normaliseJurisdictions } from './tmLibraryScope.js';

/** The KYC + AML layout is on for this tenant (needs tm_core and aml_nav_v2). */
export const amlLayoutOn = (tenant) => isFeatureEnabled(tenant, 'tm_core') && isFeatureEnabled(tenant, 'aml_nav_v2');

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
      { label: 'KYC Dashboard', domain: 'kyc', icon: 'LayoutDashboard', href: '/', permission: null, featureKey: 'dashboard' },
      { label: 'AML Dashboard', domain: 'aml', icon: 'PieChart', href: '/aml/dashboard', permission: null, anyPermission: ['viewMIDashboard', 'tmViewAlerts', 'tmQuality'], featureKey: 'tm_core' },
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
    domain: 'kyc',
    items: [
      { label: 'My Reviews', icon: 'FolderOpen', href: '/my-cases', permission: null, featureKey: 'my_cases' },
      { label: 'Reviews', icon: 'FolderOpen', href: '/all-cases', permission: 'viewAllTenantCases', featureKey: 'all_cases' },
      { label: 'Screening', icon: 'Shield', href: '/monitoring', permission: null, badge: 'alerts', featureKey: 'monitoring' },
      { label: 'Change of circumstances', icon: 'RefreshCw', href: '/kyc/changes', permission: null, featureKey: 'tm_core' },
      { label: 'Review Planner', icon: 'Calendar', href: '/review-planner', permission: 'viewAllTenantCases', featureKey: 'review_planner' },
      // Outreach keeps its own role gate (OUTREACH_ROLES) and feature flag
      { label: 'New Outreach', icon: 'Send', href: '/outreach/new', permission: null, featureKey: 'outreach', outreachOnly: true },
      { label: 'Outreach Dashboard', icon: 'Mail', href: '/outreach-dashboard', permission: null, badge: 'outreach', featureKey: 'outreach', outreachOnly: true },
    ],
  },
  {
    group: 'AML',
    domain: 'aml',
    items: [
      { label: 'Alerts', icon: 'AlertTriangle', href: '/tm/alerts', permission: 'tmViewAlerts', badge: 'tmAlerts', featureKey: 'tm_core' },
      { label: 'Investigations', icon: 'Briefcase', href: '/tm/cases', permission: 'tmViewAlerts', badge: 'tmCases', featureKey: 'tm_core' },
      { label: 'Transactions', icon: 'Activity', href: '/transaction-monitoring', permission: null, featureKey: 'transaction_monitoring' },
    ],
  },
  {
    group: 'REPORTING',
    domain: 'aml',
    items: [
      { label: 'FIU Reports', icon: 'FileText', href: '/tm/reports', permission: 'createRunCase', badge: 'fiu', featureKey: 'tm_fiu' },
    ],
  },
  {
    group: 'ADMIN',
    items: [
      { label: 'Audit Log', icon: 'ClipboardList', href: '/audit-logs', permission: 'tenantConfig', featureKey: 'audit_logs' },
      // Rules & scenarios live in Tenant Config (AML group), so rule managers and approvers also get the link
      { label: 'Tenant Config', icon: 'Settings', href: '/tenant-config', permission: null, anyPermission: ['tenantConfig', 'tmManageRules', 'tmApproveRules'], featureKey: 'tenant_config' },
      { label: 'Users', icon: 'UserCircle', href: '/user-management', permission: 'userManagement', featureKey: 'user_management' },
      { label: 'Archive', icon: 'Archive', href: '/archive', permission: 'viewArchive', featureKey: 'archive' },
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

// ── Phase 9: dashboards, My Work sections, Tenant Config groups ──
const roleOf = (user) => user?.app_role || user?.data?.app_role;

/** Tabs of the AML Dashboard a user may open (each tab is the existing page; its own check stays in place). */
export function amlDashboardTabs(user, tenant) {
  const role = roleOf(user);
  const aml = canAml(user, tenant) && isFeatureEnabled(tenant, 'tm_core');
  return [
    { id: 'overview', label: 'Overview', show: aml && hasPermission(role, 'viewMIDashboard') },
    { id: 'coverage', label: 'Data coverage', show: aml && hasPermission(role, 'tmViewAlerts') },
    { id: 'quality', label: 'Detection quality', show: aml && isFeatureEnabled(tenant, 'tm_quality') && hasPermission(role, 'tmQuality') },
  ];
}

/** Tabs of the KYC Dashboard a user may open. */
export function kycDashboardTabs(user, tenant) {
  const mi = isFeatureEnabled(tenant, 'mi_dashboard') && hasPermission(roleOf(user), 'viewMIDashboard');
  return [
    { id: 'reviews', label: 'Reviews & backlog', show: true },
    { id: 'mi', label: 'Management information', show: mi },
    { id: 'risk', label: 'Risk portfolio', show: mi },
  ];
}

/** Old routes and where they live in the new layout (used by the route redirects and tested against App.jsx). */
export const MOVED_ROUTES = {
  '/tm/mi': { to: '/aml/dashboard' },
  '/tm/coverage': { to: '/aml/dashboard', tab: 'coverage' },
  '/tm/quality': { to: '/aml/dashboard', tab: 'quality' },
  '/mi-dashboard': { to: '/', tab: 'mi' },
  '/risk-dashboard': { to: '/', tab: 'risk' },
  '/tm/rules': { to: '/tenant-config', tab: 'rules' },
};

/** My Work (spec section 10): which of the two sections an item belongs to. */
export const WORK_SECTIONS = [{ key: 'kyc', label: 'My KYC work' }, { key: 'aml', label: 'My AML work' }];
const AML_WORK_KINDS = new Set(['alert', 'tm_case', 'fiu_report', 'profile']);
export const workSection = (kind) => (AML_WORK_KINDS.has(kind) ? 'aml' : 'kyc');
/** Items ordered KYC first, then AML, keeping the order (deadline) inside each section. */
export function bySection(items) {
  const list = items || [];
  return [...list.filter((i) => workSection(i.kind) === 'kyc'), ...list.filter((i) => workSection(i.kind) === 'aml')];
}

/** Tenant Config (spec section 11): the existing tabs under General, KYC and AML. Unknown tabs go to General. */
export const TENANT_CONFIG_GROUPS = [
  { key: 'general', label: 'General', tabs: ['branding', 'roles', 'retention', 'fiu_profiles', 'integrations'] },
  { key: 'kyc', label: 'KYC', tabs: ['indicators', 'scoring', 'cycles', 'signoff', 'outreach', 'form_tmpl', 'email_tmpl'] },
  { key: 'aml', label: 'AML', tabs: ['tm_settings', 'rules', 'api_keys'] },
];
export function groupTenantTabs(visibleTabs) {
  const known = new Set(TENANT_CONFIG_GROUPS.flatMap((g) => g.tabs));
  return TENANT_CONFIG_GROUPS.map((g) => ({
    ...g,
    tabs: [
      ...g.tabs.map((id) => (visibleTabs || []).find((t) => t.id === id)).filter(Boolean),
      ...(g.key === 'general' ? (visibleTabs || []).filter((t) => !known.has(t.id)) : []),
    ],
  })).filter((g) => g.tabs.length);
}
