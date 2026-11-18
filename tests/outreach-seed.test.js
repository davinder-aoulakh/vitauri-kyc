import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildSeed, planImport, blockRow, normaliseWidget, normaliseShowIf, sourcesOf, templatiseBankName, WIDGETS } from '../base44/shared/outreachSeed.js';
import { OUTREACH_BLOCK_LIBRARY, OUTREACH_FORM_TEMPLATES } from '../base44/shared/outreachPack.js';
import { validateCondition } from '../base44/shared/outreachConditions.js';

const read = (p) => JSON.parse(readFileSync(new URL(`../${p}`, import.meta.url), 'utf8'));
const seed = buildSeed(OUTREACH_BLOCK_LIBRARY, OUTREACH_FORM_TEMPLATES);
const block = (k) => seed.blocks.find((b) => b.key === k);
const tmpl = (k) => seed.templates.find((t) => t.key === k);

test('the bundled pack equals the files in docs/outreach', () => {
  assert.deepEqual(OUTREACH_BLOCK_LIBRARY, read('docs/outreach/02-block-library.json'));
  assert.deepEqual(OUTREACH_FORM_TEMPLATES, read('docs/outreach/03-form-templates.json'));
});

test('15 NP blocks, 20 ORG blocks, 3 templates', () => {
  assert.equal(seed.blocks.filter((b) => b.client_types.includes('NP')).length, 15);
  assert.equal(seed.blocks.filter((b) => b.client_types.includes('ORG')).length, 20);
  assert.equal(seed.blocks.length, 35);
  assert.deepEqual(seed.templates.map((t) => t.key), ['onboarding_np', 'onboarding_org', 'related_party_np']);
  assert.equal(new Set(seed.blocks.map((b) => b.key)).size, 35);
});

test('every widget is a catalogue widget; pack names are mapped and kept', () => {
  for (const b of seed.blocks) assert.ok(WIDGETS.includes(b.widget), `${b.key}: ${b.widget}`);
  assert.equal(normaliseWidget('confirm_or_text'), 'confirm_facts');
  assert.equal(normaliseWidget('registry_lookup_or_document'), 'registry_search');
  assert.equal(normaliseWidget('ownership_builder'), 'owners_builder');
  assert.equal(normaliseWidget('calculated_confirm'), 'confirm_facts');
  assert.equal(normaliseWidget('chips + related_party_tracker'), 'tracker');
  assert.equal(block('registry').variants.pack_widget, 'registry_lookup_or_document');
  assert.equal(block('registry').raw.widget, 'registry_lookup_or_document');
});

test('show_if "after idv" is always true; real conditions stay and are valid', () => {
  assert.equal(normaliseShowIf('after idv'), null);
  assert.equal(block('name_confirm').show_if, null);
  assert.deepEqual(block('sow_ubo').show_if, { risk_in: ['medium', 'high'] });
  assert.deepEqual(block('docs').show_if, { not: { legal_form_kind: 'sole' } });
  const keys = seed.blocks.map((b) => b.key);
  for (const b of seed.blocks) {
    assert.deepEqual(validateCondition(b.show_if, keys), [], b.key);
    for (const f of b.follow_ups) assert.deepEqual(validateCondition(f.when, keys), [], `${b.key}.${f.id}`);
  }
});

test('default_source "kvk|doc" becomes a list of allowed sources', () => {
  assert.deepEqual(sourcesOf('kvk|doc'), ['kvk', 'doc']);
  assert.deepEqual(block('registry').datapoints[0].sources, ['kvk', 'doc']);
  assert.deepEqual(block('sof').datapoints.map((d) => d.sources), [['client'], ['doc'], ['doc'], ['ai']]);
  assert.deepEqual(block('directors').datapoints[0].sources, ['prop', 'doc', 'rep']);
});

test('templates: items and sections; RP template reuses NP blocks with pep in contact', () => {
  const np = tmpl('onboarding_np');
  assert.equal(np.items.length, 15);
  assert.deepEqual(np.sections[0], { key: 'id', label: 'Identity' });
  assert.ok(np.items.every((i) => i.active && i.block_version === 1));
  const org = tmpl('onboarding_org');
  assert.equal(org.items.length, 20);
  assert.deepEqual(org.items.filter((i) => !i.active).map((i) => i.block_key), ['decl_regulated', 'decl_nominee']);
  assert.deepEqual(org.settings, { uboThreshold: 25, ownerListThreshold: 10, releaseInvitesAfterIdv: true });
  const rp = tmpl('related_party_np');
  assert.equal(rp.client_type, 'RP');
  assert.equal(rp.items.length, 8);
  assert.equal(rp.items.find((i) => i.block_key === 'pep').section_key, 'contact');
  assert.equal(np.items.find((i) => i.block_key === 'pep').section_key, undefined);
  for (const k of ['idv', 'name_confirm', 'address', 'email', 'phone', 'pep', 'review', 'sign']) assert.ok(block(k).client_types.includes('RP'), k);
  assert.ok(!block('address_proof').client_types.includes('RP'));
});

test('rep holds the NP steps idv, name_confirm and pep', () => {
  assert.deepEqual(block('rep').variants.step_blocks, ['idv', 'name_confirm', 'pep']);
  assert.equal(block('rep').widget, 'idv');
});

test('the bank name becomes {tenant_name} everywhere except the untouched raw entry', () => {
  assert.equal(templatiseBankName('Welcome to New Age Bank.'), 'Welcome to {tenant_name}.');
  const withoutRaw = JSON.stringify({ b: seed.blocks.map(({ raw, ...r }) => r), t: seed.templates.map(({ raw, ...r }) => r) });
  assert.ok(!withoutRaw.includes('New Age Bank'));
  assert.ok(withoutRaw.includes('{tenant_name}'));
  assert.ok(tmpl('onboarding_np').intro_messages[0].includes('{tenant_name}'));
  assert.ok(JSON.stringify(seed.blocks.map((b) => b.raw)).includes('New Age Bank'));
});

test('pep follow-ups combine into pep_detail', () => {
  const f = block('pep').follow_ups;
  assert.deepEqual(f.filter((x) => x.combine_into === 'pep_detail').map((x) => x.key), ['pep_detail_who', 'pep_detail_rel']);
});

test('profile_field only where the KYC field clearly matches; the rest is reported', () => {
  const pf = (b, k) => block(b).datapoints.find((d) => d.key === k)?.profile_field;
  assert.equal(pf('idv', 'full_name'), 'full_name');
  assert.equal(pf('idv', 'dob'), 'date_of_birth');
  assert.equal(pf('email', 'email'), 'primary_contact_email');
  assert.equal(pf('registry', 'reg_no'), 'registration_number');
  assert.equal(pf('rep', 'full_name'), undefined); // the representative is not the organisation
  assert.equal(pf('sof', 'sof'), undefined);
  assert.ok(seed.unmapped.includes('sof.sof'));
  assert.ok(!seed.unmapped.includes('idv.full_name'));
  assert.ok(!seed.unmapped.some((x) => x.endsWith('.address_proof')));
});

test('evidence: required uploads, defer only where the pack allows it', () => {
  assert.equal(block('address_proof').evidence.required, true);
  assert.equal(block('address_proof').evidence.allow_defer, false);
  assert.ok(block('address_proof').evidence.document_checks.includes('Name matches your ID'));
  assert.deepEqual(Object.keys(block('docs').evidence.document_checks_by_form), ['company', 'partnership']);
  assert.equal(block('sof').follow_ups.find((f) => f.id === 'deed').allow_defer, true);
});

test('import is idempotent by key and keeps a tenant\'s own rows', () => {
  const first = planImport(seed, {});
  assert.equal(first.createBlocks.length, 35);
  assert.equal(first.createTemplates.length, 3);
  const again = planImport(seed, { blocks: seed.blocks.map((b) => ({ key: b.key })), templates: seed.templates.map((t) => ({ key: t.key })) });
  assert.equal(again.createBlocks.length + again.createTemplates.length, 0);
  assert.equal(again.skipped.length, 38);
  const partial = planImport(seed, { blocks: [{ key: 'sof' }] });
  assert.equal(partial.createBlocks.length, 34);
  assert.deepEqual(partial.skipped, ['block:sof']);
  assert.equal(blockRow({ id: 'x', widget: 'chips', label: 'X', client_types: ['NP'] }).status, 'published');
});
