// Replays scenario A of docs/outreach/06-conversation-transcripts.txt through the engine (stand-ins for ID&V and uploads).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildSeed } from '../base44/shared/outreachSeed.js';
import { OUTREACH_BLOCK_LIBRARY, OUTREACH_FORM_TEMPLATES } from '../base44/shared/outreachPack.js';
import { buildSnapshot } from '../base44/shared/outreachSnapshot.js';
import * as E from '../base44/shared/outreachEngine.js';

const seed = buildSeed(OUTREACH_BLOCK_LIBRARY, OUTREACH_FORM_TEMPLATES);
const snap = buildSnapshot({ template: seed.templates.find((t) => t.key === 'onboarding_np'), blocks: seed.blocks });
const vars = { tenant_name: 'New Age Bank', first_name: 'John', invitation_email: 'john.carter@example.com' };
const idv = { full_name: 'John Carter', dob: '14 March 1987', nat: 'British', doc: 'Passport GBR, valid until 2 September 2031' };
const file = (name) => ({ name, size: 1000, mime: 'application/pdf', test_stub: true });
const SCRIPT_A = {
  idv: { session_done: true }, name_confirm: 'Yes, this is correct',
  address: { country: 'United Kingdom', postcode: 'N1 9GU', number: '263', street: 'Upper Street', city: 'London' },
  address_proof: file('utility-bill-sept.pdf'), email: 'Yes, that is correct', phone: { code: '+44', number: '7700 900123' },
  purpose: ['Everyday payments', 'Receiving salary'], nature: ['Current account', 'Debit card'],
  employment: 'Self-employed', 'employment:company': 'Carter Consulting', income: '€ 50,000 to € 100,000',
  sof: ['Salary', 'Inheritance or gift'], 'sof:deed': file('certificate-of-inheritance.pdf'),
  activities: ['Cash deposits', 'Payments outside the EU'], 'activities:countries': 'India, Turkey',
  'activities:cash': 'About € 800 per month, because part of my income is paid in cash by tenants.',
  pep: ["I don't know", 'No'], review: 'confirmed', sign: { terms: true, typed_name: 'john carter', signature: 'data:image/png;base64,x' },
};

/** Runs a script; onStep may change the state before answering (e.g. an edit in the review). Stops after maxSteps answers. */
function run(script, { snapshot = snap, risk = 'low', onStep, maxSteps = 99 } = {}) {
  let s = E.initialState({ risk });
  const lines = [];
  const audit = [];
  let pep = 0;
  let answered = 0;
  for (let i = 0; i < 80; i++) {
    const a = E.advance(snapshot, s, vars);
    s = a.state;
    a.events.forEach((e) => audit.push(e.event));
    a.messages.forEach((m) => lines.push(['BANK', m.text, m.tag || null]));
    if (a.done || answered >= maxSteps) return { s, lines, audit, step: a.step, done: a.done };
    const k = a.step.kind === 'follow_up' ? `${a.step.block_key}:${a.step.fu_id}` : a.step.block_key;
    let v = script[k];
    if (Array.isArray(v) && k === 'pep') v = v[pep++];
    if (onStep) s = onStep(k, s, audit) || s;
    const r = E.applyAnswer(snapshot, s, a.step, v, { invitation_email: vars.invitation_email, idv });
    if (r.error) throw new Error(`${k}: ${r.error}`);
    s = r.state;
    lines.push(['CLIENT', r.clientText]);
    r.messages.forEach((m) => lines.push(['BANK', m.text, m.tag || null]));
    r.events.forEach((e) => audit.push(e.event));
    answered++;
  }
  throw new Error('did not finish');
}

/** The BANK lines of scenario A from the transcript file, from the first question up to the signing step. */
function transcriptBankLines() {
  const t = readFileSync(new URL('../docs/outreach/06-conversation-transcripts.txt', import.meta.url), 'utf8');
  const a = t.slice(t.indexOf('SCENARIO A'), t.indexOf('DATAPOINTS COLLECTED'));
  return a.split('\n').filter((l) => l.startsWith('BANK ')).map((l) => l.slice(4).trim().replace(/^\[[^\]]+\]\s*/, ''))
    .filter((l) => !l.startsWith('Hi John') && !l.startsWith('This takes about') && !l.startsWith('Thank you, John'));
}

const editInReview = (k, s, audit) => {
  if (k !== 'review') return s;
  const ed = E.applyEdit(snap, s, 'employment', 'Employed');
  ed.events.forEach((e) => audit.push(e.event));
  return ed.state;
};

test('scenario A: every bank line, in order, as in the transcript', () => {
  const { lines } = run(SCRIPT_A, { onStep: editInReview });
  const bank = lines.filter((l) => l[0] === 'BANK').map((l) => l[1]);
  assert.deepEqual(bank, transcriptBankLines());
  const tags = lines.filter((l) => l[2]).map((l) => l[2]);
  assert.deepEqual(tags, ['Follow-up question', 'Explanation']);
});

test('scenario A: the datapoints with value and source', () => {
  const { s } = run(SCRIPT_A, { onStep: editInReview });
  const got = Object.fromEntries(Object.values(s.datapoints).map((d) => [d.key, [d.display, d.source, d.block_key]]));
  const want = {
    full_name: ['John Carter', 'idv', 'idv'], dob: ['14 March 1987', 'idv', 'idv'], nat: ['British', 'idv', 'idv'], doc: ['Passport GBR, valid until 2 September 2031', 'idv', 'idv'],
    address: ['Upper Street 263, N1 9GU London, United Kingdom', 'client', 'address'], address_proof: ['utility-bill-sept.pdf', 'doc', 'address_proof'],
    email: ['john.carter@example.com', 'pre', 'email'], phone: ['+44 7700 900123', 'client', 'phone'],
    purpose: ['Everyday payments, Receiving salary', 'client', 'purpose'], nature: ['Current account, Debit card', 'client', 'nature'],
    employment: ['Employed', 'client', 'employment'], company: ['Carter Consulting', 'client', 'employment'], income: ['€ 50,000 to € 100,000', 'client', 'income'],
    sof: ['Salary, Inheritance or gift', 'client', 'sof'], sof_doc: ['certificate-of-inheritance.pdf', 'doc', 'sof'],
    activities: ['Cash deposits, Payments outside the EU', 'client', 'activities'], countries: ['India, Turkey', 'client', 'activities'],
    cash_reason: ['About € 800 per month, because part of my income is paid in cash by tenants.', 'ai', 'activities'], pep: ['No', 'client', 'pep'],
  };
  for (const [k, v] of Object.entries(want)) assert.deepEqual(got[k], v, k);
  assert.match(got.declaration[0], /^Signed \d\d\/\d\d\/\d{4}$/);
  assert.equal(Object.keys(got).length, 20);
  assert.ok(!s.datapoints.full_name.test_stub && s.datapoints.address_proof.test_stub); // real Didit since phase 4; uploads stay a stand-in until phase 5
  assert.equal(s.datapoints.employment.history[0].display, 'Self-employed'); // the edit keeps the old value
});

test('scenario A: the audit order', () => {
  const { audit } = run(SCRIPT_A, { onStep: editInReview });
  const want = [
    'block.asked', 'prefill', 'block.answered', // idv
    'block.asked', 'block.answered', 'block.asked', 'block.answered', // name_confirm, address
    'block.asked', 'doc.checked', 'block.answered', // address_proof
    'block.asked', 'block.answered', 'block.asked', 'block.answered', 'block.asked', 'block.answered', 'block.asked', 'block.answered', // email, phone, purpose, nature
    'block.asked', 'rule', 'block.asked', 'block.answered', // employment + company
    'block.asked', 'block.answered', // income
    'block.asked', 'rule', 'block.asked', 'doc.checked', 'block.answered', // sof + deed
    'block.asked', 'rule', 'block.asked', 'rule', 'ai.followup.default', 'block.asked', 'ai.followup.answered', 'block.answered', // activities
    'block.asked', 'rule', 'block.asked', 'block.answered', // pep unsure, again
    'block.asked', 'answer.edited', 'block.answered', 'block.asked', 'block.answered', // review, sign
  ];
  assert.deepEqual(audit, want);
});

test('PEP "I don\'t know": explanation, then the same question again (AT 11)', () => {
  const { lines } = run({ ...SCRIPT_A, pep: ["I don't know", "I don't know", 'No'] });
  const pepQ = lines.filter((l) => l[0] === 'BANK' && l[1].startsWith('Are you, or is someone close to you, a politically exposed'));
  assert.equal(pepQ.length, 3);
  assert.equal(lines.filter((l) => l[2] === 'Explanation').length, 2);
});

test('PEP "Yes": who and relationship are asked and combined into pep_detail', () => {
  const { s, lines } = run({ ...SCRIPT_A, pep: ['Yes'], 'pep:yes_who': 'My brother, minister of finance', 'pep:yes_rel': 'Parent or sibling' });
  assert.ok(lines.some((l) => l[1] === 'What is your relationship to this person?'));
  assert.equal(s.datapoints.pep_detail.display, 'My brother, minister of finance · Parent or sibling');
});

test('an edit in the review keeps earlier follow-up answers and asks only what is newly triggered', () => {
  const script = { ...SCRIPT_A, employment: 'Employed' };
  const { s, lines } = run(script, { onStep: (k, st, audit) => (k === 'review' ? E.applyEdit(snap, st, 'employment', 'Self-employed').state : st) });
  // the company question was not asked before, so it is asked now, before the review continues
  assert.ok(lines.some((l) => l[1] === 'What is the name of your company?'));
  assert.equal(lines.filter((l) => l[1] === 'What is the name of your company?').length, 1);
  assert.equal(s.datapoints.company.display, 'Carter Consulting');
  assert.equal(s.datapoints.employment.display, 'Self-employed');
});

test('validation: email format, phone length, address parts, none-option, sign name', () => {
  assert.ok(E.validateAnswer({ widget: 'text', fu_id: 'other_email' }, 'not-an-email'));
  assert.equal(E.validateAnswer({ widget: 'text', fu_id: 'other_email' }, 'a@b.co'), null);
  assert.ok(E.validateAnswer({ widget: 'phone' }, { code: '+44', number: '1234' }));
  assert.equal(E.validateAnswer({ widget: 'phone' }, { code: '+44', number: '7700 900123' }), null);
  assert.ok(E.validateAnswer({ widget: 'address' }, { country: 'UK', postcode: 'x', number: '1', street: '', city: 'y' }));
  assert.ok(E.validateAnswer({ widget: 'multi', options: ['A', 'None'], none_option: 'None' }, ['A', 'None']));
  assert.ok(E.validateAnswer({ widget: 'multi', options: ['A'] }, ['B']));
  const state = { datapoints: { full_name: { display: 'John Carter' } } };
  assert.match(E.validateAnswer({ widget: 'sign' }, { terms: true, typed_name: 'Jon Carter', signature: 'x' }, state), /does not match your ID \(John Carter\)/);
  assert.equal(E.validateAnswer({ widget: 'sign' }, { terms: true, typed_name: ' JOHN CARTER ', signature: 'x' }, state), null);
  assert.ok(E.validateAnswer({ widget: 'sign' }, { terms: false, typed_name: 'John Carter', signature: 'x' }, state));
  assert.ok(E.validateAnswer({ widget: 'upload', allow_defer: false }, { deferred: true }));
  assert.equal(E.validateAnswer({ widget: 'upload', allow_defer: true }, { deferred: true }), null);
});

test('a deferred deed: open request kind of answer, block counts as done, conversation can still finish', () => {
  const { s, done } = run({ ...SCRIPT_A, 'sof:deed': { deferred: true } });
  assert.equal(done, true);
  assert.equal(s.datapoints.sof_doc.status, 'deferred');
});

test('submission: canonical answers, stable hash, reference format, messages', async () => {
  const { s } = run(SCRIPT_A);
  const h1 = await E.submissionHash(s);
  const h2 = await E.submissionHash(JSON.parse(JSON.stringify(s)));
  assert.match(h1, /^[0-9a-f]{64}$/);
  assert.equal(h1, h2);
  const changed = JSON.parse(JSON.stringify(s));
  changed.datapoints.phone.value = { code: '+44', number: '0000 000000' };
  assert.notEqual(await E.submissionHash(changed), h1);
  assert.equal(E.referenceNumber('NAB', new Date('2026-11-08T10:00:00Z'), 0.004217), 'NAB-2026-004217');
  const msgs = E.submissionMessages({ first_name: 'John', response_time: '1 working day', reference: 'NAB-2026-004217' });
  assert.equal(msgs[0].text, 'Thank you, John. Your application has been submitted.');
  assert.match(msgs[1].text, /usually let you know within 1 working day how to proceed/);
  assert.equal(msgs[1].payload.reference, 'NAB-2026-004217');
});

test('review rows: grouped by section, source label, only blocks with an edit definition are editable', () => {
  const { s } = run(SCRIPT_A);
  const rows = E.reviewRows(snap, s);
  const row = (k) => rows.find((r) => r.key === k);
  assert.equal(row('full_name').source_label, 'Didit ID check');
  assert.equal(row('full_name').editable, false);
  assert.equal(row('employment').editable, true);
  assert.equal(row('email').source_label, 'Prefilled from invitation');
  assert.equal(row('purpose').section_label, 'Purpose of relationship');
  assert.equal(row('company').editable, false);
});
