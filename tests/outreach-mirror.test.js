// Guided conversation outreach, phase 10: the mirror into OutreachRequest.items[] (plan decision 10, decision 18 as
// decided on 20 Nov: every answer is copied, only linked ones feed profile suggestions) and the backstage view model.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { buildSeed } from '../base44/shared/outreachSeed.js';
import { OUTREACH_BLOCK_LIBRARY, OUTREACH_FORM_TEMPLATES } from '../base44/shared/outreachPack.js';
import { buildSnapshot } from '../base44/shared/outreachSnapshot.js';
import * as E from '../base44/shared/outreachEngine.js';
import { mirrorItems, mergeItems } from '../base44/shared/outreachMirror.js';
import { backstageView, sourceTone } from '../base44/shared/outreachBackstage.js';
import { parseAddressLine } from '../base44/shared/addressParse.js';

const seed = buildSeed(OUTREACH_BLOCK_LIBRARY, OUTREACH_FORM_TEMPLATES);
const snapNp = buildSnapshot({ template: seed.templates.find((t) => t.key === 'onboarding_np'), blocks: seed.blocks });
const vars = { tenant_name: 'Example Bank', first_name: 'John', invitation_email: 'john.carter@example.com' };
const idv = { full_name: 'John Carter', dob: '14 March 1987', nat: 'British', doc: 'Passport GBR, valid until 2 September 2031' };
const file = (name) => ({ name, size: 1000, mime: 'application/pdf', checks: [] });
const SCRIPT_A = {
  idv: { session_done: true }, name_confirm: 'Yes, this is correct',
  address: { country: 'United Kingdom', postcode: 'N1 9GU', number: '263', street: 'Upper Street', city: 'London' },
  address_proof: file('utility-bill-sept.pdf'), email: 'Yes, that is correct', phone: { code: '+44', number: '7700 900123' },
  purpose: ['Everyday payments'], nature: ['Current account'], employment: 'Employed', income: '€ 50,000 to € 100,000',
  sof: ['Salary'], activities: ['None of these'], pep: ['No'], review: 'confirmed',
  sign: { terms: true, typed_name: 'john carter', signature: 'data:image/png;base64,x' },
};

function runA() {
  let s = E.initialState({ risk: 'low' });
  for (let i = 0; i < 80; i++) {
    let a = E.advance(snapNp, s, vars);
    while (a.needs_phrasing) a = E.advance(snapNp, E.setPhrasing(a.state, { text: a.needs_phrasing.default_text, ai: false, mode: 'auto' }), vars);
    s = a.state;
    if (a.done) return s;
    const k = a.step.kind === 'follow_up' ? `${a.step.block_key}:${a.step.fu_id}` : a.step.block_key;
    let v = SCRIPT_A[k];
    if (Array.isArray(v) && k === 'pep') v = v[0];
    if (v === undefined) v = a.step.options?.[0]?.value ?? a.step.options?.[0] ?? 'Test answer';
    const r = E.applyAnswer(snapNp, s, a.step, v, { invitation_email: vars.invitation_email, idv });
    if (r.error) throw new Error(`${k}: ${r.error}`);
    s = r.state;
  }
  throw new Error('did not finish');
}
// OutreachDatapoint rows as the portal stores them (syncDatapoints)
const rowsOf = (state) => Object.values(state.datapoints).map((d) => ({ key: d.key, label: d.label, value: { v: d.value }, display_value: d.display, source: d.source, block_key: d.block_key, status: d.status }));

// extractFromOutreach is a private function of the backend function: compile just that function from the source.
function loadExtract() {
  const src = readFileSync('base44/functions/buildProfileSuggestions/entry.ts', 'utf8');
  const start = src.indexOf('function extractFromOutreach(');
  const end = src.indexOf('\nfunction ', start + 10);
  const hasLine = src.slice(src.indexOf('const hasOutreachAnswer'), src.indexOf('\n\n', src.indexOf('const hasOutreachAnswer')));
  const js = ts.transpileModule(`${hasLine}\n${src.slice(start, end)}\nreturn extractFromOutreach;`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  return new Function('parseAddressLine', js)(parseAddressLine);
}

test('mirror: one item per answer and per file, linked ones carry profile_field, idv item untouched, other items kept', () => {
  const state = runA();
  const evidence = [{ id: 'ev1', block_key: 'address_proof', datapoint_key: 'address_proof', file_uri: 'private/abc.pdf', name: 'utility-bill-sept.pdf', document_id: 'doc1', uploaded_at: '2026-11-20T10:00:00Z' }];
  const mirrored = mirrorItems({ datapoints: rowsOf(state), evidence, blocks: snapNp.blocks_snapshot });
  const byId = Object.fromEntries(mirrored.map((i) => [i.item_id, i]));
  assert.equal(byId['dp:address'].profile_field, 'residential_address');
  assert.equal(byId['dp:address'].response_value.zipcode, 'N1 9GU');
  assert.equal(byId['dp:email'].profile_field, 'primary_contact_email');
  assert.ok(byId['dp:purpose'] && !byId['dp:purpose'].profile_field, 'unlinked answers are copied without a link');
  assert.equal(byId['ev:ev1'].file_url, 'private/abc.pdf');
  assert.equal(byId['ev:ev1'].item_type, 'document');
  assert.ok(mirrored.every((i) => i.status === 'Received' && i.origin === 'conversation'));
  assert.ok(!mirrored.some((i) => i.item_id.startsWith('dp:address_proof')), 'file datapoints come from the evidence rows');

  const idvItem = { item_id: 'idv', field_type: 'id_verification', status: 'Pass', didit_session_id: 's1' };
  const other = { item_id: 'classic_1', label: 'Other', status: 'Pending' };
  const once = mergeItems([idvItem, other], mirrored);
  const twice = mergeItems(once, mirrored);
  assert.deepEqual(twice, once, 'idempotent');
  assert.deepEqual(twice[0], idvItem);
  assert.deepEqual(twice[1], other);
  // a verified item keeps its status when the answer did not change; a changed answer goes back to Received
  const verified = once.map((i) => (i.item_id === 'dp:email' ? { ...i, status: 'Verified' } : i));
  assert.equal(mergeItems(verified, mirrored).find((i) => i.item_id === 'dp:email').status, 'Verified');
  const changed = mirrored.map((i) => (i.item_id === 'dp:email' ? { ...i, response_text: 'new@example.com' } : i));
  assert.equal(mergeItems(verified, changed).find((i) => i.item_id === 'dp:email').status, 'Received');
});

test('mirror -> profile suggestions (scenario A, NP): linked fields only, no label guessing for conversation items', () => {
  const extract = loadExtract();
  const items = mirrorItems({ datapoints: rowsOf(runA()), evidence: [], blocks: snapNp.blocks_snapshot });
  const c = extract([{ items }], false, {});
  assert.equal(c['residential_address.city'][0].value, 'London');
  assert.equal(c['residential_address.zipcode'][0].value, 'N1 9GU');
  assert.ok(c.primary_contact_email?.length);
  assert.ok(c.full_name?.length && c.date_of_birth?.length && c.nationality?.length);
  const fields = Object.keys(c);
  const allowed = new Set(['full_name', 'date_of_birth', 'nationality', 'primary_contact_email', 'primary_contact_phone', 'residential_address.street', 'residential_address.number', 'residential_address.zipcode', 'residential_address.city', 'residential_address.country']);
  assert.deepEqual(fields.filter((f) => !allowed.has(f)), [], 'no suggestion from unlinked answers');
});

test('mirror -> profile suggestions (scenario C, ORG registry facts); the representative name never becomes the company name', () => {
  const extract = loadExtract();
  const snapOrg = buildSnapshot({ template: seed.templates.find((t) => t.client_type === 'ORG'), blocks: seed.blocks });
  const rows = [
    { key: 'legal_name', label: 'Legal name', value: { v: 'Clarke Trading B.V.' }, display_value: 'Clarke Trading B.V.', source: 'kvk', block_key: 'registry' },
    { key: 'reg_no', label: 'Registration number', value: { v: '81234568' }, display_value: 'KvK 81234568', source: 'kvk', block_key: 'registry' },
    { key: 'co_address', label: 'Registered address', value: { v: 'Keizersgracht 1, 1015 CJ Amsterdam' }, display_value: 'Keizersgracht 1, 1015 CJ Amsterdam', source: 'kvk', block_key: 'registry' },
    { key: 'full_name', label: 'Full name', value: { v: 'Emma Clarke' }, display_value: 'Emma Clarke', source: 'idv', block_key: 'rep' },
    { key: 'o_countries', label: 'Countries', value: { v: ['Germany'] }, display_value: 'Germany', source: 'client', block_key: 'countries_org' },
  ];
  const items = mirrorItems({ datapoints: rows, evidence: [], blocks: snapOrg.blocks_snapshot });
  const c = extract([{ items }], true, {});
  assert.deepEqual(c.full_name.map((x) => x.value), ['Clarke Trading B.V.']);
  assert.equal(c.registration_number[0].value, '81234568');
  assert.ok(c.registered_address?.length);
  assert.ok(!c.registered_country, 'the countries answer is not guessed as the registered country');
});

test('backstage view: seven parts, source tones, ORG active switch state and parties', () => {
  const state = runA();
  const conversation = {
    id: 'c1', client_type: 'NP', template_key: snapNp.template_key, template_version: 1, template_snapshot: snapNp.template_snapshot, blocks_snapshot: snapNp.blocks_snapshot,
    block_states: state.block_states, risk_class: 'low', status: 'Submitted', deadline: '2026-12-15T00:00:00Z', language: 'en',
  };
  const v = backstageView({ conversation, settings: { aiFollowUp: { low: 'auto' }, reminderDays: [3, 7, 12] }, datapoints: rowsOf(state), events: [{ id: 'a', event_type: 'outreach.case.submitted', created_date: '2026-11-20T10:02:00Z', notes: 'signed' }, { id: 'b', event_type: 'outreach.block.asked', created_date: '2026-11-20T10:00:00Z' }], openRequests: [{ id: 'r', title: 'Annual accounts', from_name: 'Sanne', status: 'open', kind: 'analyst_request' }] });
  assert.ok(v.template.some((r) => r.setting === 'Risk class' && r.value === 'low'));
  assert.equal(v.blocks.length, snapNp.template_snapshot.items.length);
  assert.ok(v.blocks.find((b) => b.key === 'address').kyc_mapping.includes('residential_address'));
  assert.equal(v.blocks.find((b) => b.key === 'pep').state, 'answered');
  assert.equal(v.audit[0].event, 'case.submitted', 'newest first');
  assert.equal(v.requests[0].from, 'Sanne');
  assert.ok(v.rules[0].includes('sent at once'));
  assert.equal(v.structure, undefined);
  assert.equal(sourceTone('idv'), 'green');
  assert.equal(sourceTone('ai'), 'indigo');
  assert.equal(sourceTone('client'), 'neutral');

  const org = backstageView({
    conversation: { ...conversation, client_type: 'ORG', pending_step: { engine: { route: 'nl' } } }, settings: { uboThreshold: 25 }, datapoints: [], events: [], openRequests: [],
    invites: [{ id: 'i', roles_text: 'David Okoye|Director', status: 'Invited' }], structureCard: { title: 'Structure' },
    publishedItems: snapNp.template_snapshot.items.map((it) => (it.block_key === 'nature' ? { ...it, active: false } : it)),
  });
  assert.equal(org.blocks.find((b) => b.key === 'nature').active_now, false, 'the switch shows the published template, not this request');
  assert.ok(org.template.some((r) => r.setting === 'Route' && /KvK/.test(r.value)));
  assert.equal(org.parties[0].name, 'David Okoye');
  assert.ok(org.rules.some((r) => /UBOs are calculated/.test(r)));
});

test('audit coverage: every spec section 12 event is written somewhere in the backend (known gaps listed)', () => {
  const spec = readFileSync('docs/outreach/01-Base44-Build-Spec-Client-Outreach.md', 'utf8');
  const sec = spec.slice(spec.indexOf('## 12.'), spec.indexOf('## 13.'));
  const events = [...new Set([...sec.matchAll(/\|\s*([^|\n]+?)\s*\|[^|\n]*\|\s*$/gm)].flatMap((m) => [...m[1].matchAll(/`([a-z_]+(?:\.[a-z_]+)+|rule|prefill)`/g)].map((x) => x[1])))];
  assert.ok(events.length > 30, `parsed ${events.length} events`);
  const files = [
    'base44/shared/outreachEngine.js', 'base44/functions/outreachPortal/entry.ts', 'base44/functions/outreachUpload/entry.ts', 'base44/functions/outreachRegistry/entry.ts',
    'base44/functions/manageOutreachConversation/entry.ts', 'base44/functions/manageOutreachConfig/entry.ts', 'base44/functions/sendOutreachConversation/entry.ts',
    'base44/functions/outreachSweep/entry.ts', 'base44/shared/outreachChildRequest.js', 'base44/functions/seedOutreachLibrary/entry.ts',
  ];
  const code = files.map((f) => readFileSync(f, 'utf8')).join('\n');
  const written = (e) => code.includes(`'${e}'`) || code.includes(`"${e}"`) || code.includes(`'outreach.${e}'`) || code.includes(`event: \`${e}`);
  const missing = events.filter((e) => !written(e)).sort();
  // Known gaps (reported in phase 10): the second-source vendor is not used (Didit replaces it, decision 2); the
  // registry adapters log every KvK call as an OutreachAdapterCall row (with cost) instead of separate kvk.* events.
  const KNOWN = ['company.info.organisatieprofiel', 'kvk.basisprofiel', 'kvk.zoeken'];
  assert.deepEqual(missing, KNOWN.filter((k) => events.includes(k)).sort(), `missing: ${missing.join(', ')}`);
});
