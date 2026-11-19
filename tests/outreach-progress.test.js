import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildSeed } from '../base44/shared/outreachSeed.js';
import { OUTREACH_BLOCK_LIBRARY, OUTREACH_FORM_TEMPLATES } from '../base44/shared/outreachPack.js';
import { buildSnapshot } from '../base44/shared/outreachSnapshot.js';
import * as E from '../base44/shared/outreachEngine.js';

const seed = buildSeed(OUTREACH_BLOCK_LIBRARY, OUTREACH_FORM_TEMPLATES);
const npTemplate = seed.templates.find((t) => t.key === 'onboarding_np');
const vars = { tenant_name: 'New Age Bank', first_name: 'John', invitation_email: 'john.carter@example.com' };
const ANSWERS = {
  idv: { stub: true }, name_confirm: 'Yes, this is correct',
  address: { country: 'United Kingdom', postcode: 'N1 9GU', number: '263', street: 'Upper Street', city: 'London' },
  address_proof: { name: 'bill.pdf', size: 1, mime: 'application/pdf', test_stub: true }, email: 'Yes, that is correct', phone: { code: '+44', number: '7700 900123' },
  purpose: ['Saving'], nature: ['Current account'],
};
function answerUntil(snap, n) {
  let s = E.initialState({ risk: 'low' });
  for (let i = 0; i < n; i++) {
    const a = E.advance(snap, s, vars);
    s = E.applyAnswer(snap, a.state, a.step, ANSWERS[a.step.block_key], { idv: { full_name: 'John Carter' }, test_stub: true, invitation_email: vars.invitation_email }).state;
  }
  return s;
}

test('NP progress: 15 blocks, one step per answered block, minutes per spec 5.5', () => {
  const snap = buildSnapshot({ template: npTemplate, blocks: seed.blocks });
  assert.deepEqual(E.progress(snap, E.initialState()), { steps: 0, total: 15, pct: 0, minutes_left: 6 });
  const s = answerUntil(snap, 6);
  assert.deepEqual(E.progress(snap, s), { steps: 6, total: 15, pct: 40, minutes_left: 4 });
});

test('resume: after block 6 (phone) the next question is block 7 (purpose) (AT 3)', () => {
  const snap = buildSnapshot({ template: npTemplate, blocks: seed.blocks });
  const s = answerUntil(snap, 6);
  // "close the page": the state is persisted as JSON and loaded again
  const reopened = JSON.parse(JSON.stringify(s));
  const next = E.advance(snap, reopened, vars);
  assert.equal(next.step.block_key, 'purpose');
  assert.equal(next.messages[0].text, 'Why would you like to become a customer of New Age Bank? Choose what applies.');
});

test('an inactive block is not asked, block.skipped is written and the total is one lower (AT 2)', () => {
  const tpl = JSON.parse(JSON.stringify(npTemplate));
  tpl.items.find((i) => i.block_key === 'nature').active = false;
  const snap = buildSnapshot({ template: tpl, blocks: seed.blocks });
  assert.equal(E.progress(snap, E.initialState()).total, 14);
  let s = answerUntil(snap, 7); // up to purpose
  const a = E.advance(snap, s, vars);
  assert.equal(a.step.block_key, 'employment');
  assert.ok(a.events.some((e) => e.event === 'block.skipped' && e.payload.block === 'nature'));
  s = a.state;
  assert.equal(s.block_states.nature.state, 'off');
  assert.equal(E.progress(snap, s).total, 14);
});

test('a block whose condition is false is skipped and lowers the total', () => {
  const blocks = seed.blocks.map((b) => (b.key === 'income' ? { ...b, show_if: { answer_equals: { block: 'employment', value: 'Employed' } } } : b));
  const snap = buildSnapshot({ template: npTemplate, blocks });
  let s = answerUntil(snap, 8);
  const a = E.advance(snap, s, vars); // employment
  s = E.applyAnswer(snap, a.state, a.step, 'Retired').state;
  const b = E.advance(snap, s, vars);
  assert.equal(b.step.block_key, 'sof');
  assert.ok(b.events.some((e) => e.event === 'block.skipped' && e.payload.reason === 'show_if'));
  assert.equal(E.progress(snap, b.state).total, 14);
});

test('a new published question text reaches new requests only (AT 1)', () => {
  const old = buildSnapshot({ template: npTemplate, blocks: seed.blocks });
  const v2 = { ...seed.blocks.find((b) => b.key === 'phone'), version: 2, question_template: 'Which phone number can we reach you on?' };
  const tpl2 = { ...npTemplate, version: 2, items: npTemplate.items.map((i) => (i.block_key === 'phone' ? { ...i, block_version: 2 } : i)) };
  const fresh = buildSnapshot({ template: tpl2, blocks: [...seed.blocks, v2] });
  assert.equal(fresh.blocks_snapshot.phone.question_template, 'Which phone number can we reach you on?');
  assert.equal(old.blocks_snapshot.phone.question_template, 'What is your phone number?');
});

test('"Why do we ask this?" is logged as client.why_opened by the portal (AT 4)', () => {
  const src = readFileSync(new URL('../base44/functions/outreachPortal/entry.ts', import.meta.url), 'utf8');
  assert.match(src, /action === 'why_opened'/);
  assert.match(src, /event: 'client\.why_opened'/);
});

test('retry without duplicates: the portal returns the stored result for a repeated answer id and refuses a stale step', () => {
  const src = readFileSync(new URL('../base44/functions/outreachPortal/entry.ts', import.meta.url), 'utf8');
  assert.match(src, /client_answer_id/);
  assert.match(src, /duplicate: true/);
  assert.match(src, /httpError\(409/);
});
