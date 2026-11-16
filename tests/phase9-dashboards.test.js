// Phase 9: dashboards as tabbed pages, My Work in two sections, Tenant Config groups, moved routes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  amlNavItems, amlDashboardTabs, kycDashboardTabs, MOVED_ROUTES, WORK_SECTIONS, workSection, bySection,
  TENANT_CONFIG_GROUPS, groupTenantTabs,
} from '../src/lib/amlNav.js';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const on = { features_enabled: { tm_core: true, aml_nav_v2: true, tm_quality: true, mi_dashboard: true }, tm_settings: {} };
const separate = { ...on, tm_settings: { role_model: 'separate' } };
const shown = (tabs) => tabs.filter((t) => t.show).map((t) => t.id);

test('sidebar matches spec section 2: no separate MI, Risk, Rules, Coverage or Quality links', () => {
  const labels = (g) => amlNavItems.find((x) => x.group === g).items.map((i) => i.label);
  assert.deepEqual(labels('OVERVIEW'), ['My Work', 'KYC Dashboard', 'AML Dashboard']);
  assert.deepEqual(labels('REPORTING'), ['FIU Reports']);
  assert.deepEqual(labels('ADMIN'), ['Audit Log', 'Tenant Config', 'Users', 'Archive']);
  const aml = amlNavItems.flatMap((g) => g.items).find((i) => i.label === 'AML Dashboard');
  assert.equal(aml.href, '/aml/dashboard');
  assert.deepEqual(aml.anyPermission, ['viewMIDashboard', 'tmViewAlerts', 'tmQuality']);
  // rule managers and approvers reach Rules & scenarios through Tenant Config
  const tc = amlNavItems.flatMap((g) => g.items).find((i) => i.label === 'Tenant Config');
  assert.ok(tc.anyPermission.includes('tmManageRules') && tc.anyPermission.includes('tenantConfig'));
});

test('AML Dashboard tabs follow the permissions of the pages they show', () => {
  assert.deepEqual(amlDashboardTabs({ app_role: 'Compliance Officer' }, on).map((t) => t.label), ['Overview', 'Data coverage', 'Detection quality']);
  assert.deepEqual(shown(amlDashboardTabs({ app_role: 'Compliance Officer' }, on)), ['overview', 'coverage', 'quality']);
  assert.deepEqual(shown(amlDashboardTabs({ app_role: 'Analyst' }, on)), ['coverage']);
  // The admin roles see the Overview (first, so it is the default tab); Detection quality stays with QC / Compliance / Director.
  assert.deepEqual(shown(amlDashboardTabs({ app_role: 'Tenant Admin' }, on)), ['overview', 'coverage']);
  assert.deepEqual(shown(amlDashboardTabs({ app_role: 'Compliance Admin' }, on)), ['overview', 'coverage']);
  assert.deepEqual(shown(amlDashboardTabs({ app_role: 'Analyst', work_domain: 'kyc' }, separate)), []);
  assert.deepEqual(shown(amlDashboardTabs({ app_role: 'Director' }, { ...on, features_enabled: { ...on.features_enabled, tm_quality: false } })), ['overview', 'coverage']);
});

test('KYC Dashboard: everyone gets Reviews & backlog; MI and Risk need the MI permission', () => {
  assert.deepEqual(shown(kycDashboardTabs({ app_role: 'Analyst' }, on)), ['reviews']);
  assert.deepEqual(shown(kycDashboardTabs({ app_role: 'Manager' }, on)), ['reviews', 'mi', 'risk']);
  assert.deepEqual(shown(kycDashboardTabs({ app_role: 'Tenant Admin' }, on)), ['reviews', 'mi', 'risk']);
  assert.deepEqual(shown(kycDashboardTabs({ app_role: 'Compliance Admin' }, on)), ['reviews', 'mi', 'risk']);
});

test('old routes redirect to their new place, and every target exists', () => {
  const app = read('src/App.jsx');
  const routes = new Set([...app.matchAll(/path="([^"]+)"/g)].map((m) => m[1]));
  assert.deepEqual(Object.keys(MOVED_ROUTES).sort(), ['/mi-dashboard', '/risk-dashboard', '/tm/coverage', '/tm/mi', '/tm/quality', '/tm/rules']);
  for (const [from, { to, tab }] of Object.entries(MOVED_ROUTES)) {
    assert.ok(routes.has(from), `${from} is still a route`);
    assert.ok(routes.has(to), `${to} exists`);
    const line = app.split('\n').find((l) => l.includes(`path="${from}"`));
    assert.ok(line.includes(`<V2Redirect to="${to}"`) && line.includes('legacy={'), `${from} redirects only with the new layout`);
    if (tab) assert.ok(line.includes(`tab="${tab}"`), `${from} → tab ${tab}`);
  }
  // the home page is the old Dashboard with the layout off
  assert.ok(app.includes('<Route path="/" element={<LayoutSwitch v2={<KycDashboard />} legacy={<Dashboard />} />} />'));
  assert.ok(routes.has('/aml/dashboard'));
});

test('My Work: KYC items first, then AML items, order inside a section kept', () => {
  assert.deepEqual(WORK_SECTIONS.map((s) => s.label), ['My KYC work', 'My AML work']);
  for (const k of ['kyc_case', 'edr', 'outreach']) assert.equal(workSection(k), 'kyc', k);
  for (const k of ['alert', 'tm_case', 'fiu_report', 'profile']) assert.equal(workSection(k), 'aml', k);
  const items = [{ id: 1, kind: 'alert' }, { id: 2, kind: 'kyc_case' }, { id: 3, kind: 'fiu_report' }, { id: 4, kind: 'edr' }];
  assert.deepEqual(bySection(items).map((i) => i.id), [2, 4, 1, 3]);
  assert.deepEqual(bySection(undefined), []);
});

test('Tenant Config tabs are grouped General / KYC / AML; nothing is lost', () => {
  assert.deepEqual(TENANT_CONFIG_GROUPS.map((g) => g.label), ['General', 'KYC', 'AML']);
  const ids = [...read('src/pages/TenantConfig.jsx').matchAll(/\{ id: '([a-z_]+)',\s+label:/g)].map((m) => m[1]);
  const all = [...new Set([...ids, 'rules'])].map((id) => ({ id, label: id }));
  const groups = groupTenantTabs(all);
  assert.deepEqual(groups.flatMap((g) => g.tabs.map((t) => t.id)).sort(), all.map((t) => t.id).sort());
  assert.ok(groups.find((g) => g.key === 'aml').tabs.some((t) => t.id === 'rules'));
  assert.ok(groups.find((g) => g.key === 'kyc').tabs.some((t) => t.id === 'signoff'));
  // an unknown tab is not dropped, and an empty group is not shown
  assert.equal(groupTenantTabs([{ id: 'something_new' }])[0].key, 'general');
  assert.deepEqual(groupTenantTabs([{ id: 'rules' }]).map((g) => g.key), ['aml']);
});

test('a page shown as a tab does not draw the app shell again', () => {
  const shell = read('src/components/layout/AppShell.jsx');
  assert.ok(shell.includes('useContext(EmbeddedContext)') && shell.includes('function AppShellFrame('));
  assert.ok(read('src/components/layout/TabbedPage.jsx').includes('<EmbeddedContext.Provider value>'));
  assert.ok(read('src/pages/TenantConfig.jsx').includes('<EmbeddedContext.Provider value><TmRules /></EmbeddedContext.Provider>'));
});
