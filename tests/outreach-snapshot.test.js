import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pickTemplate, buildSnapshot, fillPlaceholders, firstNameOf, initialProgressTotal, sectionsView, minutesLeft } from '../base44/shared/outreachSnapshot.js';
import { buildSeed } from '../base44/shared/outreachSeed.js';
import { OUTREACH_BLOCK_LIBRARY, OUTREACH_FORM_TEMPLATES } from '../base44/shared/outreachPack.js';
import { outreachAuditRow } from '../base44/shared/outreachAudit.js';
import { inviteEmail } from '../base44/shared/outreachEmail.js';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const seed = buildSeed(OUTREACH_BLOCK_LIBRARY, OUTREACH_FORM_TEMPLATES);
const blocks = seed.blocks.map((b, i) => ({ ...b, id: `b${i}` }));
const templates = seed.templates.map((t, i) => ({ ...t, id: `t${i}` }));

test('the published template for the client type and case type is picked; drafts never', () => {
  assert.equal(pickTemplate(templates, 'NP', 'Onboarding').key, 'onboarding_np');
  assert.equal(pickTemplate(templates, 'ORG', 'Onboarding').key, 'onboarding_org');
  assert.equal(pickTemplate(templates, 'NP', 'Periodic_Review'), null);
  const v2draft = { ...templates[0], id: 'x', version: 2, status: 'draft' };
  assert.equal(pickTemplate([...templates, v2draft], 'NP', 'Onboarding').version, 1);
  const v2 = { ...templates[0], id: 'y', version: 2, status: 'published' };
  assert.equal(pickTemplate([...templates, v2], 'NP', 'Onboarding').version, 2);
});

test('the snapshot holds the published template and its pinned block versions', () => {
  const s = buildSnapshot({ template: templates[0], blocks, settings: { uboThreshold: 25 }, kvkMode: 'test' });
  assert.equal(s.template_key, 'onboarding_np');
  assert.equal(Object.keys(s.blocks_snapshot).length, 15);
  assert.equal(s.blocks_snapshot.sof.follow_ups.length, 3);
  assert.equal(s.kvk_environment, 'test');
  assert.equal(s.settings_snapshot.uboThreshold, 25);
  assert.ok(!('raw' in s.blocks_snapshot.sof));
  assert.equal(buildSnapshot({ template: templates[0], blocks }).kvk_environment, 'off');
});

test('a later edit or a new version never changes a request already sent', () => {
  const src = blocks.map((b) => ({ ...b, follow_ups: JSON.parse(JSON.stringify(b.follow_ups)) }));
  const s = buildSnapshot({ template: templates[0], blocks: src });
  const before = JSON.stringify(s);
  const sof = src.find((b) => b.key === 'sof');
  sof.question_template = 'Changed later';
  sof.follow_ups.push({ id: 'new' });
  src.push({ ...sof, id: 'v2', version: 2, status: 'draft', question_template: 'Draft text' });
  src.push({ ...sof, id: 'v3', version: 3, status: 'published', question_template: 'Version 3' });
  templates[0].items[0].active = !templates[0].items[0].active;
  assert.equal(JSON.stringify(s), before);
  templates[0].items[0].active = !templates[0].items[0].active;
});

test('items stay on their pinned version; drafts are never used; a missing block refuses to send', () => {
  const v2draft = { ...blocks.find((b) => b.key === 'sof'), id: 'd', version: 2, status: 'draft', question_template: 'Draft' };
  assert.notEqual(buildSnapshot({ template: templates[0], blocks: [...blocks, v2draft] }).blocks_snapshot.sof.question_template, 'Draft');
  const v2 = { ...v2draft, id: 'p', status: 'published', question_template: 'V2' };
  assert.equal(buildSnapshot({ template: templates[0], blocks: [...blocks, v2] }).blocks_snapshot.sof.version, 1); // pinned v1 still exists
  assert.throws(() => buildSnapshot({ template: templates[0], blocks: blocks.filter((b) => b.key !== 'pep') }), /pep/);
  assert.throws(() => buildSnapshot({ template: { ...templates[0], status: 'draft' }, blocks }), /published/);
});

test('placeholders, first name, progress, sections and minutes', () => {
  assert.equal(fillPlaceholders('Hi {first_name}, welcome to {tenant_name}.', { first_name: 'John', tenant_name: 'Acme' }), 'Hi John, welcome to Acme.');
  assert.equal(fillPlaceholders('Hi {first_name}, {unknown} here.', { first_name: 'John' }), 'Hi John, here.');
  assert.equal(firstNameOf({ preferred_name: 'David Z' }), 'David');
  assert.equal(firstNameOf({ first_names: 'Evert David' }), 'Evert');
  assert.equal(firstNameOf({}, 'John Smith'), 'John');
  const s = buildSnapshot({ template: templates[0], blocks });
  assert.equal(initialProgressTotal(s), 15);
  assert.equal(initialProgressTotal(buildSnapshot({ template: templates[1], blocks })), 18); // two declaration blocks are off
  const secs = sectionsView(s, { idv: { state: 'answered' }, name_confirm: { state: 'answered' }, address: { state: 'answered' }, address_proof: { state: 'answered' } }, 'email');
  assert.deepEqual(secs.slice(0, 3).map((x) => x.state), ['done', 'current', 'todo']);
  assert.equal(minutesLeft(15, 0), 6);
  assert.equal(minutesLeft(15, 15), 0);
});

test('audit rows: outreach. prefix, personal data in payload, not in notes', () => {
  const r = outreachAuditRow({ tenantId: 't', event: 'request.sent', actor: { type: 'User', id: 'u', name: 'Ann' }, conversation: { id: 'c', request_id: 'r', case_id: 'k', client_id: 'cl' }, payload: { invited_email: 'a@b.c' }, notes: 'Sent.' });
  assert.equal(r.event_type, 'outreach.request.sent');
  assert.equal(r.outreach_request_id, 'r');
  assert.equal(r.payload.invited_email, 'a@b.c');
  assert.equal(r.payload.conversation_id, 'c');
  assert.ok(!r.notes.includes('a@b.c'));
  assert.equal(outreachAuditRow({ tenantId: 't', event: 'outreach.client.opened', actor: { type: 'Client' } }).event_type, 'outreach.client.opened');
  assert.equal(outreachAuditRow({ tenantId: 't', event: 'client.opened', actor: { type: 'Client' } }).actor_user_id, undefined);
});

test('invitation email: tenant template when present, else a neutral default; link always included, values escaped', () => {
  const vars = { first_name: '<b>John</b>', tenant_name: 'Acme Bank', link: 'https://app.example/o/abc', deadline_date: '2 December 2026', minutes: 6 };
  const d = inviteEmail({ vars });
  assert.match(d.subject, /Acme Bank/);
  assert.ok(d.body.includes('https://app.example/o/abc'));
  assert.ok(d.body.includes('&lt;b&gt;John'));
  assert.equal(d.from_template, false);
  const own = inviteEmail({ templates: [{ situation: 'Conversation_Invite_ORG', subject: 'Your account at {tenant_name}', body_html: '<p>Dear {first_name}</p>' }], clientType: 'ORG', vars });
  assert.equal(own.subject, 'Your account at Acme Bank');
  assert.ok(own.body.includes('https://app.example/o/abc'));
  assert.ok(!read('base44/shared/outreachEmail.js').includes('New Age Bank'));
});

test('routes: /o/:token is public next to the classic portal; existing outreach routes unchanged', () => {
  const app = read('src/App.jsx');
  const pub = app.slice(app.indexOf('<Routes>', app.indexOf('function App(')), app.indexOf('ProtectedRoute unauthenticatedElement'));
  assert.match(pub, /path="\/o\/:token" element=\{<OutreachConversation \/>\}/);
  assert.match(pub, /path="\/portal\/:token" element=\{<ClientPortal \/>\}/);
  assert.match(app, /path="\/outreach\/new" element=\{<StandaloneOutreach \/>\}/);
  assert.match(app, /path="\/outreach-dashboard" element=\{<OutreachDashboard \/>\}/);
  assert.ok(!/path="\/outreach\/:token"/.test(app));
});

test('the public page calls the portal function only, never entities', () => {
  const page = read('src/pages/OutreachConversation.jsx');
  assert.ok(!/base44\.entities/.test(page));
  assert.match(page, /functions\.invoke\('outreachPortal'/);
  assert.ok(!/https?:\/\/(?!www\.w3\.org)/.test(page.replace(/\/\/.*$/gm, ''))); // no external resources
});

test('flag: the staff panel needs the flag; the send function refuses when it is off; the portal does not check it', () => {
  const cw = read('src/pages/CaseWorkspace.jsx');
  assert.match(cw, /activeStep === 1 && isFeatureEnabled\(tenant, 'outreach_conversation'\) && <ConversationPanel/);
  assert.match(read('base44/functions/sendOutreachConversation/entry.ts'), /if \(!conversationOn\(tenant\)\) throw httpError\(403/);
  assert.ok(!/conversationOn/.test(read('base44/functions/outreachPortal/entry.ts')));
  const send = read('base44/functions/sendOutreachConversation/entry.ts');
  assert.match(send, /assertNotLocked/); // tipping-off check before any email
  assert.ok(!/access_token/.test(send.replace(/\/\/.*$/gm, ''))); // never sets the classic token
});
