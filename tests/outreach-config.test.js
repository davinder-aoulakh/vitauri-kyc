import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { versionsByKey, nextVersion, cleanBlockInput, cleanTemplateInput, draftFrom, pinItems, cleanIntegration, BLOCK_FIELDS } from '../base44/shared/outreachConfig.js';
import { outreachSettings, cleanSettings, conversationOn, registryProvider, OUTREACH_DEFAULTS, OUTREACH_FLAG } from '../base44/shared/outreachSettings.js';
import { getFeatureDefinition, isFeatureEnabled } from '../src/lib/featureFlags.js';
import { hasPermission } from '../src/lib/permissions.js';
import { OUTREACH_CONFIG_ROLES, OUTREACH_WORK_ROLES } from '../base44/shared/outreachAuth.js';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

test('the flag is off by default and listed with the Outreach switches', () => {
  const def = getFeatureDefinition(OUTREACH_FLAG);
  assert.equal(def.defaultOff, true);
  assert.equal(def.label, 'Guided conversation outreach');
  assert.equal(isFeatureEnabled({}, OUTREACH_FLAG), false);
  assert.equal(isFeatureEnabled({ features_enabled: '{"outreach":true}' }, OUTREACH_FLAG), false);
  assert.equal(conversationOn({}), false);
  assert.equal(conversationOn({ features_enabled: '{"outreach_conversation":true}' }), true);
  assert.equal(conversationOn({ features_enabled: { outreach_conversation: true } }), true);
  assert.equal(conversationOn({ features_enabled: 'not json' }), false);
  assert.match(read('src/lib/featureFlags.js'), /group: 'Outreach',[\s\S]*?outreach_conversation[\s\S]*?\]/);
});

test('permissions match the server role lists', () => {
  for (const r of OUTREACH_CONFIG_ROLES) assert.ok(hasPermission(r, 'outreachConfig'), r);
  assert.ok(!hasPermission('Analyst', 'outreachConfig'));
  for (const r of OUTREACH_WORK_ROLES) assert.ok(hasPermission(r, 'outreachConversationWork'), r);
  assert.ok(!hasPermission('Vitauri Ops', 'outreachConversationWork'));
  const classic = read('base44/functions/sendOutreachEmail/entry.ts');
  assert.match(classic, /\[\.\.\.WORK_ROLES, 'Director', 'Compliance Admin', 'Tenant Admin'\]/); // same roles as the classic outreach email
});

test('with the flag off Tenant Config renders the classic tabs only', () => {
  const tc = read('src/pages/TenantConfig.jsx');
  assert.match(tc, /isFeatureEnabled\(tenant, 'outreach_conversation'\)/);
  assert.match(tc, /<OutreachTemplatesTab tenant=\{tenant\} \/>/);
  assert.match(tc, /<FormTemplatesTab tenant=\{tenant\} \/>/);
  for (const f of ['seedOutreachLibrary', 'manageOutreachConfig']) assert.match(read(`base44/functions/${f}/entry.ts`), /if \(!conversationOn\(tenant\)\) throw httpError\(403/);
});

test('settings: defaults, cleaning, no unknown keys', () => {
  const s = outreachSettings({});
  assert.equal(s.uboThreshold, 25);
  assert.equal(s.ownerListThreshold, 10);
  assert.equal(s.releaseInvitesAfterIdv, true);
  assert.deepEqual(s.aiFollowUp, { low: 'auto', medium: 'approval', high: 'approval' });
  assert.ok(s.phoneCountryCodes.includes('+599'));
  assert.ok(s.addressCountries.includes('Curaçao'));
  assert.equal(outreachSettings({ outreach_settings: { uboThreshold: 10 } }).uboThreshold, 10);
  const c = cleanSettings({ uboThreshold: 250, reminderDays: [12, 3, 3, 'x'], kvk_api_key: 'secret', aiFollowUp: { low: 'approval' }, phoneCountryCodes: ['+31', 'abc'] });
  assert.equal(c.settings.uboThreshold, OUTREACH_DEFAULTS.uboThreshold);
  assert.ok(c.errors.includes('uboThreshold'));
  assert.deepEqual(c.settings.reminderDays, [3, 12]);
  assert.equal('kvk_api_key' in c.settings, false);
  assert.equal(c.settings.aiFollowUp.low, 'approval');
  assert.deepEqual(c.settings.phoneCountryCodes, ['+31']);
  assert.deepEqual(cleanSettings({ aiFollowUp: { low: 'sometimes' } }).errors, ['aiFollowUp']);
});

test('registry: Didit by default, KvK for the Netherlands in test or live', () => {
  assert.equal(registryProvider('off').label, 'Didit (default)');
  assert.equal(registryProvider(undefined).nl, 'didit');
  assert.equal(registryProvider('test').nl, 'kvk');
  assert.equal(registryProvider('live').other, 'didit');
});

test('versions: one published and one draft per key; drafts get version + 1', () => {
  const rows = [{ key: 'sof', version: 1, status: 'published' }, { key: 'sof', version: 2, status: 'draft' }, { key: 'pep', version: 3, status: 'published' }];
  const v = versionsByKey(rows);
  assert.equal(v.sof.published.version, 1);
  assert.equal(v.sof.draft.version, 2);
  assert.equal(v.pep.draft, null);
  assert.equal(nextVersion(rows, 'sof'), 3);
  assert.equal(nextVersion(rows, 'new'), 1);
  const d = draftFrom({ id: 'x', key: 'sof', version: 1, status: 'published', label: 'Source of funds', raw: { a: 1 }, created_date: 'y' }, BLOCK_FIELDS, 2);
  assert.deepEqual(d, { label: 'Source of funds', key: 'sof', raw: { a: 1 }, version: 2, status: 'draft' });
  assert.deepEqual(pinItems([{ block_key: 'sof', block_version: 1 }], { sof: { version: 4 } }), [{ block_key: 'sof', block_version: 4 }]);
});

test('block edits: widget, sources, actions and conditions are checked', () => {
  const ok = cleanBlockInput({ label: 'X', widget: 'multi', show_if: { answer_includes: { block: 'sof', value: 'Salary' } }, follow_ups: [{ action: 'ask_text', when: { risk_in: ['high'] } }] }, ['sof']);
  assert.deepEqual(ok.errors, []);
  assert.match(cleanBlockInput({ widget: 'slider' }).errors.join(), /unknown widget/);
  assert.match(cleanBlockInput({ datapoints: [{ key: 'a', sources: ['web'] }] }).errors.join(), /unknown source web/);
  assert.match(cleanBlockInput({ follow_ups: [{ action: 'call_bank' }] }).errors.join(), /unknown action/);
  assert.match(cleanBlockInput({ show_if: { answer_includes: { block: 'nope', value: 'x' } } }, ['sof']).errors.join(), /unknown block "nope"/);
  assert.match(cleanBlockInput({ label: '' }).errors.join(), /label: required/);
  assert.match(cleanBlockInput({ client_types: ['XX'] }).errors.join(), /client_types/);
});

test('template edits: known blocks, no duplicates, numbers in range', () => {
  const ok = cleanTemplateInput({ name: 'T', items: [{ block_key: 'sof', active: false }], sections: [{ key: 'fin', label: 'Financial' }] }, ['sof']);
  assert.deepEqual(ok.errors, []);
  assert.deepEqual(ok.fields.items, [{ block_key: 'sof', block_version: null, active: false }]);
  assert.match(cleanTemplateInput({ items: [{ block_key: 'x' }] }, ['sof']).errors.join(), /unknown block "x"/);
  assert.match(cleanTemplateInput({ items: [{ block_key: 'sof' }, { block_key: 'sof' }] }, ['sof']).errors.join(), /listed twice/);
  assert.match(cleanTemplateInput({ default_deadline_days: 0 }).errors.join(), /1 to 365/);
});

test('integration: Live needs a key; removing the key ends Live', () => {
  assert.deepEqual(cleanIntegration({ kvk_mode: 'live' }, { hasKey: false }).errors, ['kvk_mode: Live needs a KvK API key first']);
  assert.deepEqual(cleanIntegration({ kvk_mode: 'live' }, { hasKey: true }).errors, []);
  assert.deepEqual(cleanIntegration({ kvk_mode: 'test' }).errors, []);
  assert.match(cleanIntegration({ kvk_mode: 'on' }).errors.join(), /off, test or live/);
  assert.match(cleanIntegration({ kvk_api_key: 'short' }).errors.join(), /does not look like/);
  assert.equal(cleanIntegration({ kvk_api_key: '' }, { hasKey: true }).patch.kvk_mode_if_live, 'off');
  assert.deepEqual(cleanIntegration({ kvk_api_key: 'l7xx1234567890abcdef', kvk_mode: 'live' }).errors, []);
});

test('the key is never returned by the config function', () => {
  const src = read('base44/functions/manageOutreachConfig/entry.ts');
  assert.ok(!/kvk_api_key:\s*s\?\.kvk_api_key/.test(src));
  assert.match(src, /kvk_key_last4/);
});
