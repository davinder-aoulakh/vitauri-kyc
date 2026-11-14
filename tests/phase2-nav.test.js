// Phase 2: sidebar selection and content, customer file tabs, libraries per jurisdiction (spec test 13).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { selectNav, amlNavItems, CLIENT_TABS_V2, clientTabFor } from '../src/lib/amlNav.js';
import { librariesFor, libraryCodesFor, normaliseJurisdictions, scenarioInScope } from '../base44/shared/tmLibraryScope.js';
import { PERMISSIONS } from '../src/lib/permissions.js';
import { FEATURE_DEFINITIONS, isFeatureEnabled } from '../src/lib/featureFlags.js';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const items = amlNavItems.flatMap((g) => g.items);

test('sidebar choice: nothing changes unless tm_core and aml_nav_v2 are both on', () => {
  assert.equal(selectNav({ tmCore: false, amlNavV2: false }), 'legacy');
  assert.equal(selectNav({ tmCore: false, amlNavV2: true }), 'legacy');
  assert.equal(selectNav({ tmCore: true, amlNavV2: false }), 'tm');
  assert.equal(selectNav({ tmCore: true, amlNavV2: true }), 'aml');
});

test('aml_nav_v2 is off by default', () => {
  assert.equal(isFeatureEnabled({}, 'aml_nav_v2'), false);
  assert.equal(isFeatureEnabled({ features_enabled: { aml_nav_v2: true } }, 'aml_nav_v2'), true);
});

test('groups follow spec section 2', () => {
  assert.deepEqual(amlNavItems.map((g) => g.group), ['OVERVIEW', 'CUSTOMERS', 'KYC', 'AML', 'REPORTING', 'ADMIN']);
  const labels = (g) => amlNavItems.find((x) => x.group === g).items.map((i) => i.label);
  assert.deepEqual(labels('AML'), ['Alerts', 'Investigations', 'Transactions']);
  assert.deepEqual(labels('CUSTOMERS'), ['New Client', 'Client Search']);
  assert.ok(labels('KYC').includes('Reviews') && labels('KYC').includes('Screening'));
  assert.equal(labels('REPORTING')[0], 'FIU Reports');
  assert.deepEqual(labels('OVERVIEW'), ['My Work', 'KYC Dashboard', 'AML Dashboard']);
});

test('every link is an existing route, and no link appears twice', () => {
  const routes = new Set([...read('src/App.jsx').matchAll(/path="([^"]+)"/g)].map((m) => m[1]));
  for (const i of items) assert.ok(routes.has(i.href), `no route for ${i.label} → ${i.href}`);
  assert.equal(new Set(items.map((i) => i.href)).size, items.length);
});

test('every item keeps a real permission and feature key', () => {
  const featureKeys = new Set(FEATURE_DEFINITIONS.flatMap((g) => g.features.map((f) => f.key)));
  for (const i of items) {
    for (const p of [i.permission, ...(i.anyPermission || [])].filter(Boolean)) assert.ok(PERMISSIONS[p], `unknown permission ${p} on ${i.label}`);
    if (i.featureKey) assert.ok(featureKeys.has(i.featureKey), `unknown feature ${i.featureKey} on ${i.label}`);
  }
});

test('nothing reachable in the current tm sidebar is lost', () => {
  const shell = read('src/components/layout/AppShell.jsx');
  const current = new Set([...shell.matchAll(/href: '([^']+)'/g)].map((m) => m[1]));
  const kept = new Set(items.map((i) => i.href));
  // Batch Screening becomes a button on the Screening page (decision D1); Monitoring MI is the AML Dashboard link.
  const moved = new Set(['/batch-screening']);
  for (const href of current) assert.ok(kept.has(href) || moved.has(href), `${href} is no longer reachable`);
});

test('outreach items keep their role gate and feature flag', () => {
  const outreach = items.filter((i) => i.href.startsWith('/outreach'));
  assert.equal(outreach.length, 2);
  assert.ok(outreach.every((i) => i.outreachOnly === true && i.featureKey === 'outreach'));
});

test('customer file: five new tabs first, the existing ones after', () => {
  assert.deepEqual(CLIENT_TABS_V2.slice(0, 5).map((t) => t.label), ['Overview', 'Accounts & transactions', 'Expected profile', 'Reviews & changes', 'Alerts & investigations']);
  assert.deepEqual(CLIENT_TABS_V2.slice(5).map((t) => t.value), ['profile', 'related-parties', 'documents', 'audit-trail']);
});

test('old customer links land on the right new tab', () => {
  assert.deepEqual(clientTabFor('overview', 'transactions'), { tab: 'accounts', view: null });
  assert.deepEqual(clientTabFor('overview', 'profile'), { tab: 'expected-profile', view: null });
  assert.deepEqual(clientTabFor('overview', 'work'), { tab: 'alerts', view: null });
  assert.deepEqual(clientTabFor('overview', 'network'), { tab: 'overview', view: 'network' });
  assert.deepEqual(clientTabFor('overview', 'timeline'), { tab: 'overview', view: 'timeline' });
  assert.deepEqual(clientTabFor('monitoring', null), { tab: 'overview', view: null });
  assert.deepEqual(clientTabFor(null, null), { tab: 'overview', view: null });
  assert.deepEqual(clientTabFor('documents', null), { tab: 'documents', view: null });
  assert.deepEqual(clientTabFor('cases', null), { tab: 'cases', view: null });
  assert.deepEqual(clientTabFor('nonsense', 'x'), { tab: 'overview', view: null });
});

test('spec test 13: an NL tenant sees no Curaçao library', () => {
  assert.deepEqual(libraryCodesFor(['NL']), ['NL']);
  assert.deepEqual(libraryCodesFor(['CW']), ['CW']);
  assert.deepEqual(libraryCodesFor(['nl', 'be']), ['NL']);
  assert.deepEqual(libraryCodesFor(['BE']), []);
  assert.equal(librariesFor(['NL'])[0].label, 'Library: Wwft indicators');
});

test('no jurisdictions configured: both libraries, as before', () => {
  for (const v of [undefined, null, [], '', ['x', 123]]) assert.deepEqual(libraryCodesFor(v), ['CW', 'NL'], JSON.stringify(v));
  assert.deepEqual(normaliseJurisdictions('nl, cw;be'), ['NL', 'CW', 'BE']);
});

test('library scenarios are seeded only for the tenant jurisdictions', () => {
  assert.equal(scenarioInScope('ALL', ['NL']), true);
  assert.equal(scenarioInScope('CW', ['NL']), false);
  assert.equal(scenarioInScope('CW', ['NL', 'CW']), true);
  assert.equal(scenarioInScope('CW', []), true);
  assert.equal(scenarioInScope(undefined, ['NL']), true);
});
