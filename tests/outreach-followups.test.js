// Phase 5: AI follow-ups (spec 6.2) and scenario B (High risk, proof of address in another name, payslip, approval).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validatePhrasing, approvalMode, phraseFollowUp } from '../base44/shared/outreachAiFollowup.js';
import { buildSeed } from '../base44/shared/outreachSeed.js';
import { OUTREACH_BLOCK_LIBRARY, OUTREACH_FORM_TEMPLATES } from '../base44/shared/outreachPack.js';
import { buildSnapshot } from '../base44/shared/outreachSnapshot.js';
import * as E from '../base44/shared/outreachEngine.js';

test('phrasing validation: one question, two sentences, no risk or screening words', () => {
  assert.equal(validatePhrasing('You expect to deposit cash. Roughly what amount per month, and why in cash?').ok, true);
  assert.equal(validatePhrasing('How much? And why?').ok, false);
  assert.equal(validatePhrasing('Thanks. You chose cash. How much per month?').ok, false);
  assert.equal(validatePhrasing('For our risk assessment: how much cash per month?').ok, false);
  assert.equal(validatePhrasing('After screening, how much cash do you deposit?').ok, false);
  assert.equal(validatePhrasing('How much cash do you deposit').ok, false);
  assert.equal(validatePhrasing('').ok, false);
});

test('approval mode by risk class from the settings', () => {
  const settings = { aiFollowUp: { low: 'auto', medium: 'approval', high: 'approval' } };
  assert.equal(approvalMode(settings, 'low'), 'auto');
  assert.equal(approvalMode(settings, 'High'), 'approval');
  assert.equal(approvalMode({}, 'low'), 'approval'); // missing setting: safe side
});

test('phraseFollowUp falls back to the default text on invalid output or an AI error', async () => {
  const input = { default_text: 'Roughly what amount per month, and why in cash?', answer: ['Cash deposits'], block_label: 'Activities' };
  assert.deepEqual((await phraseFollowUp(async () => ({ question: 'You expect cash deposits. How much per month, and why?' }), input)).ai, true);
  const bad = await phraseFollowUp(async () => ({ question: 'Due to our risk policy, how much cash?' }), input);
  assert.equal(bad.text, input.default_text);
  assert.equal(bad.ai, false);
  const err = await phraseFollowUp(async () => { throw new Error('down'); }, input);
  assert.equal(err.text, input.default_text);
  assert.match(err.reason, /AI call failed/);
});

// ── Scenario B through the engine ──────────────────────────────────────────────────────────────────────────
const seed = buildSeed(OUTREACH_BLOCK_LIBRARY, OUTREACH_FORM_TEMPLATES);
const snap = buildSnapshot({ template: seed.templates.find((t) => t.key === 'onboarding_np'), blocks: seed.blocks });
const vars = { tenant_name: 'New Age Bank', first_name: 'John', invitation_email: 'john.carter@example.com' };
const idv = { full_name: 'John Carter', dob: '14 March 1987', nat: 'British', doc: 'Passport GBR, valid until 2 September 2031' };
const ok = (names) => names.map((n) => ({ name: n, ok: true, message: '' }));
const proof = (nameOk) => ({ evidence_id: 'ev', name: 'utility-bill-sept.pdf', size: 1000, mime: 'application/pdf', checks: [
  { name: 'Readable and complete', ok: true }, { name: 'Name matches your ID', ok: nameOk, message: nameOk ? '' : 'The document says "M. Jansen"' },
  { name: 'Address matches what you entered', ok: true }, { name: 'Not older than 3 months', ok: true }] });
const file = (name) => ({ evidence_id: 'ev', name, size: 1000, mime: 'application/pdf', checks: ok(['Readable and complete']) });

function runB({ approver = 'Sanne de Vries', mode = 'approval', maxAi = 3 } = {}) {
  let s = E.initialState({ risk: 'high' });
  const lines = [];
  const audit = [];
  let proofs = 0;
  let pep = 0;
  let waited = 0;
  const script = {
    idv: { session_done: true }, name_confirm: 'Yes, this is correct',
    address: { country: 'United Kingdom', postcode: 'N1 9GU', number: '263', street: 'Upper Street', city: 'London' },
    email: 'Yes, that is correct', phone: { code: '+44', number: '7700 900123' },
    purpose: ['Everyday payments', 'Receiving salary'], nature: ['Current account', 'Debit card'],
    employment: 'Self-employed', 'employment:company': 'Carter Consulting', income: '€ 50,000 to € 100,000',
    sof: ['Salary', 'Inheritance or gift'], 'sof:deed': file('certificate-of-inheritance.pdf'), 'sof:payslip': file('payslip-aug.pdf'),
    activities: ['Cash deposits', 'Payments outside the EU'], 'activities:countries': 'India, Turkey',
    'activities:cash': 'About € 800 per month, because part of my income is paid in cash by tenants.',
    review: 'confirmed', sign: { terms: true, typed_name: 'John Carter', signature: 'data:image/png;base64,x' },
  };
  for (let i = 0; i < 90; i++) {
    let a = E.advance(snap, s, vars);
    while (a.needs_phrasing) {
      if ((a.state.ai_count || 0) >= maxAi) { const d = E.dropQueued(a.state, 'limit'); d.events.forEach((e) => audit.push(e.event)); a = E.advance(snap, d.state, vars); continue; }
      const st = E.setPhrasing(a.state, { text: a.needs_phrasing.default_text, ai: true, mode });
      if (mode === 'approval') { lines.push(['BANK', 'A colleague is taking a quick look at your answer. This will only take a moment.', 'One moment']); audit.push('ai.followup.pending'); }
      a = E.advance(snap, st, vars);
    }
    if (a.step?.widget === 'wait') { waited++; a = E.advance(snap, E.approvePhrasing(a.state, { text: a.state.queue[0].proposal.text, ai: true, approver }), vars); audit.push('ai.followup.approved'); }
    s = a.state;
    a.events.forEach((e) => audit.push(e.event));
    a.messages.forEach((m) => lines.push(['BANK', m.text, m.tag || null, !!m.ai_assisted]));
    if (a.done) return { s, lines, audit, waited };
    const k = a.step.kind === 'follow_up' ? `${a.step.block_key}:${a.step.fu_id}` : a.step.block_key;
    let v = script[k];
    if (k === 'address_proof') v = proof(proofs++ > 0);
    if (k === 'pep') v = [`I don't know`, 'No'][pep++];
    const r = E.applyAnswer(snap, s, a.step, v, { invitation_email: vars.invitation_email, idv });
    if (r.error) throw new Error(`${k}: ${r.error}`);
    s = r.state;
    lines.push(['CLIENT', r.clientText]);
    r.messages.forEach((m) => lines.push(['BANK', m.text, m.tag || null]));
    r.events.forEach((e) => audit.push(e.event));
  }
  throw new Error('did not finish');
}

function transcriptB() {
  const t = readFileSync(new URL('../docs/outreach/06-conversation-transcripts.txt', import.meta.url), 'utf8');
  const b = t.slice(t.indexOf('SCENARIO B'), t.indexOf('SCENARIO C'));
  const body = b.slice(0, b.indexOf('DATAPOINTS COLLECTED'));
  return body.split('\n').filter((l) => l.startsWith('BANK ')).map((l) => l.slice(4).trim().replace(/^\[[^\]]+\]\s*/, ''))
    .filter((l) => !l.startsWith('Hi John') && !l.startsWith('This takes about') && !l.startsWith('Thank you, John'));
}

test('scenario B: every bank line as in the transcript (re-request, payslip, held follow-up, PEP explanation)', () => {
  const { lines, waited } = runB();
  assert.equal(waited, 1);
  assert.deepEqual(lines.filter((l) => l[0] === 'BANK').map((l) => l[1]), transcriptB());
});

test('scenario B: tags — Document checked, One moment, checked by the approver with AI-assisted', () => {
  const { lines } = runB();
  const tagged = lines.filter((l) => l[2]);
  assert.deepEqual(tagged.map((l) => l[2]), ['Document checked', 'One moment', 'Follow-up question, checked by Sanne de Vries', 'Explanation']);
  assert.equal(tagged[2][3], true); // AI-assisted pill
});

test('scenario B: proof of address re-requested once; the payslip has no "later"; audit has pending and approved', () => {
  const { s, audit, lines } = runB();
  assert.equal(lines.filter((l) => l[1]?.startsWith('Do you have a recent proof of this address')).length, 2);
  assert.equal(s.datapoints.address_proof.status, 'passed');
  assert.equal(s.datapoints.payslip.display, 'payslip-aug.pdf');
  assert.equal(s.datapoints.cash_reason.source, 'ai');
  const i = audit.indexOf('ai.followup.pending');
  assert.ok(i >= 0 && audit.indexOf('ai.followup.approved') > i);
  assert.ok(!audit.includes('ai.followup.default'));
  assert.ok(audit.filter((e) => e === 'doc.checked').length >= 4);
});

test('Low risk: the follow-up is asked at once (ai.followup.auto); over the limit it is not asked', () => {
  const low = runB({ mode: 'auto' });
  assert.equal(low.waited, 0);
  assert.ok(low.audit.includes('ai.followup.auto'));
  assert.ok(low.lines.some((l) => l[2] === 'Follow-up question'));
  const none = runB({ mode: 'auto', maxAi: 0 });
  assert.ok(!none.lines.some((l) => /deposit cash/.test(l[1] || '')));
  assert.ok(!none.s.datapoints.cash_reason);
});

test('a third failing proof of address is kept for manual review (at most two re-requests)', () => {
  const snapA = snap;
  let s = E.initialState({ risk: 'high' });
  const go = (v) => { let a = E.advance(snapA, s, vars); while (a.step?.block_key !== 'address_proof') { const k = a.step.block_key; const val = { idv: { session_done: true }, name_confirm: 'Yes, this is correct', address: { country: 'UK', postcode: 'N1', number: '1', street: 'X', city: 'L' } }[k]; s = E.applyAnswer(snapA, a.state, a.step, val, { idv }).state; a = E.advance(snapA, s, vars); } return E.applyAnswer(snapA, a.state, a.step, v, {}); };
  let r = go(proof(false)); assert.equal(r.reask, true); s = r.state;
  r = go(proof(false)); assert.equal(r.reask, true); s = r.state;
  r = go(proof(false)); assert.ok(!r.reask);
  assert.equal(r.state.datapoints.address_proof.status, 'failed');
  assert.ok(r.events.some((e) => /manual review/.test(e.notes)));
});

test('source: uploads go to outreachUpload (private), the page still never touches entities', () => {
  const up = readFileSync(new URL('../base44/functions/outreachUpload/entry.ts', import.meta.url), 'utf8');
  assert.match(up, /UploadPrivateFile/);
  assert.ok(!/UploadFile\(/.test(up.replace(/UploadPrivateFile/g, '')));
  assert.match(up, /MAX_MB = 25/);
  const w = readFileSync(new URL('../src/components/outreachconv/widgets/Upload.jsx', import.meta.url), 'utf8');
  assert.match(w, /allow_defer/);
  assert.ok(!/base44/.test(w));
  const portal = readFileSync(new URL('../base44/functions/outreachPortal/entry.ts', import.meta.url), 'utf8');
  assert.ok(!/test_stub: true/.test(portal));
});
