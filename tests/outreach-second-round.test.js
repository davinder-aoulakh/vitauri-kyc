// Guided conversation outreach, phase 9: second round, composer, reminders, emails (spec 5.6, 5.7; AT 34, 35).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import {
  remindersDue, linkExpired, followUpTimedOut, conversationEmail, emailTemplatesToSeed, SITUATIONS,
  analystRequestMessages, answeredMessage, clientMessageMessages, cleanMessage, roleLabel,
} from '../base44/shared/outreachSecondRound.js';
import { setPhrasing } from '../base44/shared/outreachEngine.js';

const DAY = 86400000;
const deadline = new Date('2026-12-15T12:00:00Z');
const conv = (extra = {}) => ({ status: 'In_Progress', deadline: deadline.toISOString(), reminders_sent: [], ...extra });
const at = (daysBefore) => new Date(deadline.getTime() - daysBefore * DAY + 60000);

test('AT 34: analyst request = system line + analyst message with upload, tagged name and role (transcript A tail)', () => {
  const [sys, msg] = analystRequestMessages({ name: 'Sanne de Vries', role: 'Analyst', text: 'Could you upload your latest annual accounts?', request_type: 'document', open_request_id: 'r1' });
  assert.equal(sys.kind, 'system_line');
  assert.equal(sys.text, 'New message from a colleague');
  assert.equal(msg.author_type, 'analyst');
  assert.equal(msg.tag, 'Sanne de Vries, Compliance analyst');
  assert.deepEqual(msg.payload, { open_request_id: 'r1', request_type: 'document', widget: 'upload' });
  const ok = answeredMessage({ name: 'Sanne de Vries', role: 'Analyst' });
  assert.equal(ok.text, 'Thank you, received. I will take a look and let you know if I need anything else.');
  assert.equal(ok.tag, 'Sanne de Vries, Compliance analyst');
  assert.equal(analystRequestMessages({ name: 'X', role: 'Manager', text: 'Q?', request_type: 'question' })[1].payload.widget, 'text');
  assert.equal(roleLabel('Unknown role'), 'Compliance');
});

test('AT 35: composer message gets the automatic reply (tag Automatic reply)', () => {
  const [c, auto] = clientMessageMessages('  When will I hear back?  ');
  assert.equal(c.author_type, 'client');
  assert.equal(c.text, 'When will I hear back?');
  assert.equal(auto.tag, 'Automatic reply');
  assert.equal(auto.text, 'Thank you for your message. A colleague reads along and will respond in this conversation. Everything is saved in your file.');
  assert.throws(() => cleanMessage('   '), /answer/);
  assert.throws(() => cleanMessage('x'.repeat(2001)), /2000/);
});

test('reminders: at the configured days before the deadline, once each, closest value only', () => {
  const days = [3, 7, 12];
  assert.deepEqual(remindersDue({ conversation: conv(), reminderDays: days, now: at(13) }), { due: null, mark: [] });
  assert.deepEqual(remindersDue({ conversation: conv(), reminderDays: days, now: at(12) }), { due: 12, mark: [12] });
  assert.equal(remindersDue({ conversation: conv({ reminders_sent: [12] }), reminderDays: days, now: at(10) }).due, null);
  // a missed sweep: at 2 days before, 7 and 3 are both reached -> one email (3), both marked
  assert.deepEqual(remindersDue({ conversation: conv({ reminders_sent: [12] }), reminderDays: days, now: at(2) }), { due: 3, mark: [7, 3] });
  // not after submission, not after the deadline
  assert.equal(remindersDue({ conversation: conv({ status: 'Submitted' }), reminderDays: days, now: at(2) }).due, null);
  assert.equal(remindersDue({ conversation: conv(), reminderDays: days, now: new Date(deadline.getTime() + 1000) }).due, null);
});

test('expiry and held AI follow-up timeout (decision 12)', () => {
  const now = new Date('2026-12-01T10:00:00Z');
  assert.equal(linkExpired({ status: 'Opened', token_expires_at: '2026-11-30T00:00:00Z' }, now), true);
  assert.equal(linkExpired({ status: 'Submitted', token_expires_at: '2026-11-30T00:00:00Z' }, now), false);
  assert.equal(linkExpired({ status: 'Opened', token_expires_at: '2026-12-30T00:00:00Z' }, now), false);
  const held = setPhrasing({ queue: [{ block: 'cash', fu: 'f1' }] }, { text: 'Why cash?', ai: true, mode: 'approval', now: '2026-12-01T08:30:00Z' }).queue[0];
  assert.equal(held.held_since, '2026-12-01T08:30:00Z');
  assert.equal(followUpTimedOut(held, 60, now), true);
  assert.equal(followUpTimedOut(held, 120, now), false);
  assert.equal(followUpTimedOut({ held: false }, 1, now), false);
});

test('emails: tenant template wins, link or no-link variant, first name and company only, no bank name in code', () => {
  const vars = { first_name: 'Emma', company: 'Clarke Trading B.V.', tenant_name: 'Example Bank', link: 'https://app.example/o/abc', deadline_date: '15 December 2026' };
  const m = conversationEmail({ situation: SITUATIONS.REMINDER, vars });
  assert.match(m.subject, /Example Bank/);
  assert.match(m.body, /Hi Emma/);
  assert.ok(m.body.includes('https://app.example/o/abc'));
  const noLink = conversationEmail({ situation: SITUATIONS.NEW_MESSAGE, vars: { ...vars, link: '' } });
  assert.ok(!noLink.body.includes('href'));
  assert.match(noLink.body, /link in the invitation email/);
  const own = conversationEmail({ templates: [{ situation: SITUATIONS.NEW_MESSAGE, subject: 'Message for {first_name}', body_html: '<p>{company}: <a href="{link}">open</a></p>' }], situation: SITUATIONS.NEW_MESSAGE, vars });
  assert.equal(own.from_template, true);
  assert.equal(own.subject, 'Message for Emma');
  assert.ok(own.body.includes('Clarke Trading B.V.'));
  const esc = conversationEmail({ situation: SITUATIONS.NEW_MESSAGE, vars: { ...vars, first_name: '<b>x</b>' } });
  assert.ok(!esc.body.includes('<b>x</b>'));
  const src = readFileSync('base44/shared/outreachSecondRound.js', 'utf8');
  assert.ok(!/New Age Bank/i.test(src));
});

test('email templates seeded per tenant: the five situations, existing ones untouched', () => {
  const rows = emailTemplatesToSeed([{ situation: SITUATIONS.REMINDER }], 't1');
  assert.equal(rows.length, 4);
  assert.ok(rows.every((r) => r.tenant_id === 't1' && r.is_active && r.subject && r.body_html));
  assert.ok(!rows.some((r) => r.situation === SITUATIONS.REMINDER));
  assert.equal(emailTemplatesToSeed([], 't1').length, 5);
});

test('wiring: portal message action, request.opened, upload open requests, sweep workflow, token stays server-only', () => {
  const portal = readFileSync('base44/functions/outreachPortal/entry.ts', 'utf8');
  assert.ok(portal.includes("action === 'message'"));
  assert.ok(portal.includes("event: 'request.opened'"));
  assert.ok(portal.includes("event: 'client.message'"));
  assert.ok(!portal.includes('OutreachLinkToken'));
  const upload = readFileSync('base44/functions/outreachUpload/entry.ts', 'utf8');
  assert.ok(upload.includes('open_request_id') && upload.includes("event: 'request.answered'") && upload.includes("event: 'request.deferred'"));
  const manage = readFileSync('base44/functions/manageOutreachConversation/entry.ts', 'utf8');
  assert.ok(manage.includes("action === 'ask'") && manage.includes('assertNotLocked') && manage.includes("'request.created'"));
  const wf = JSON.parse(readFileSync('base44/workflows/Outreach Conversation Sweep.jsonc', 'utf8'));
  assert.equal(wf.definition.do[0].run_function.with.function_name, 'outreachSweep');
  assert.ok(existsSync('base44/functions/outreachSweep/entry.ts'));
  const ent = JSON.parse(readFileSync('base44/entities/OutreachLinkToken.jsonc', 'utf8'));
  assert.equal(ent.rls.read, false);
  for (const f of ['src/pages/OutreachConversation.jsx', 'src/components/outreachconv/SecondRound.jsx', 'src/components/outreachconv/backstage/SecondRoundPanel.jsx']) {
    assert.ok(!readFileSync(f, 'utf8').includes('OutreachLinkToken'), f);
  }
});
