// Phase 4: the Didit ID&V step of the guided conversation (outreachIdv.js, engine idv handling, related-party template).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { idvFromItem, idvChecks, idvState, sameName, longDate, countryName } from '../base44/shared/outreachIdv.js';
import { buildSeed } from '../base44/shared/outreachSeed.js';
import { OUTREACH_BLOCK_LIBRARY, OUTREACH_FORM_TEMPLATES } from '../base44/shared/outreachPack.js';
import { buildSnapshot, fillPlaceholders } from '../base44/shared/outreachSnapshot.js';
import * as E from '../base44/shared/outreachEngine.js';

// A carrier 'idv' item as getDiditSessionResult / diditWebhook store it (extractIdvFields in diditDecision.js).
const approvedItem = {
  item_id: 'idv', field_type: 'id_verification', didit_session_id: 'ses_1', didit_session_url: 'https://verify.didit.me/s/1', didit_session_status: 'Approved',
  idv_status: 'Pass', idv_extracted_first_name: 'John', idv_extracted_last_name: 'Carter', idv_extracted_dob: '1987-03-14',
  idv_extracted_nationality: 'GBR', idv_document_type: 'PASSPORT', idv_issuing_country: 'GBR', idv_document_number: '123456789',
  idv_document_expiry: '2031-09-02', idv_liveness_passed: true, idv_similarity_score: 92,
};

test('field mapping: names, date, ISO3 nationality, document text', () => {
  assert.deepEqual(idvFromItem(approvedItem), { full_name: 'John Carter', dob: '14 March 1987', nat: 'United Kingdom', doc: 'Passport GBR, valid until 2 September 2031' });
  assert.equal(longDate('2001-12-01T00:00:00Z'), '1 December 2001');
  assert.equal(countryName('NLD'), 'Netherlands');
  assert.equal(countryName('XYZ'), 'XYZ');
  assert.equal(idvFromItem({ idv_document_type: 'identity_card' }).doc, 'Identity Card');
});

test('the four checks', () => {
  assert.deepEqual(idvChecks(approvedItem).map((c) => c.ok), [true, true, true, true]);
  assert.deepEqual(idvChecks(approvedItem).map((c) => c.label), ['ID document read', 'Selfie and liveness checked', 'Face matches document', 'Document is genuine and valid']);
  const declined = { ...approvedItem, idv_status: 'Fail', idv_liveness_passed: false, idv_similarity_score: 40 };
  assert.deepEqual(idvChecks(declined).map((c) => c.ok), [true, false, false, false]);
});

test('idvState: none, open session reused, approved, in review, declined with and without attempts, expired', () => {
  assert.equal(idvState({ item_id: 'idv' }).state, 'none');
  assert.equal(idvState({ item_id: 'idv' }).can_start, true);
  const open = idvState({ didit_session_id: 's', didit_session_url: 'https://x', didit_session_status: 'Not Started', idv_status: 'Pending' }, { attempts: 1 });
  assert.equal(open.state, 'open');
  assert.equal(open.session_url, 'https://x');
  assert.equal(open.can_start, false); // reused: no new session
  assert.equal(idvState(approvedItem).state, 'approved');
  assert.equal(idvState({ ...approvedItem, idv_status: 'Inconclusive', didit_session_status: 'In Review' }).state, 'in_review');
  const d1 = idvState({ ...approvedItem, idv_status: 'Fail', didit_session_status: 'Declined' }, { attempts: 1, maxAttempts: 3 });
  assert.equal(d1.state, 'declined');
  assert.equal(d1.can_start, true);
  assert.equal(d1.attempts_left, 2);
  assert.equal(idvState({ ...approvedItem, idv_status: 'Fail', didit_session_status: 'Declined' }, { attempts: 3, maxAttempts: 3 }).can_start, false);
  assert.equal(idvState({ ...approvedItem, idv_status: 'Expired', didit_session_status: 'Expired' }, { attempts: 1 }).state, 'expired');
  assert.equal(idvState({ ...approvedItem, idv_status: 'Fail', didit_session_status: 'Abandoned' }, { attempts: 1 }).state, 'expired');
});

test('name comparison ignores case, accents and spaces (AT 12)', () => {
  assert.ok(sameName('john  carter', 'John Carter'));
  assert.ok(sameName('José Núñez', 'Jose Nunez'));
  assert.ok(!sameName('Jon Carter', 'John Carter'));
  assert.ok(!sameName('', ''));
  const st = { datapoints: { full_name: { display: 'John Carter' } } };
  const sign = { widget: 'sign' };
  assert.match(E.validateAnswer(sign, { terms: true, typed_name: 'Johnny Carter', signature: 'data:x' }, st), /does not match your ID \(John Carter\)/);
  assert.equal(E.validateAnswer(sign, { terms: true, typed_name: 'JOHN CARTER', signature: 'data:x' }, st), null);
});

const seed = buildSeed(OUTREACH_BLOCK_LIBRARY, OUTREACH_FORM_TEMPLATES);
const npSnap = buildSnapshot({ template: seed.templates.find((t) => t.key === 'onboarding_np'), blocks: seed.blocks });

test('approved Didit result: four datapoints with source idv, checks, then the confirmation question (AT 13)', () => {
  let s = E.initialState();
  let a = E.advance(npSnap, s, {});
  assert.equal(a.step.widget, 'idv');
  const r = E.applyAnswer(npSnap, a.state, a.step, { session_done: true }, { idv: idvFromItem(approvedItem), idv_outcome: 'approved' });
  assert.ok(!r.error);
  assert.equal(r.clientText, 'I completed the identity check');
  for (const k of ['full_name', 'dob', 'nat', 'doc']) { assert.equal(r.state.datapoints[k].source, 'idv'); assert.ok(!r.state.datapoints[k].test_stub); }
  a = E.advance(npSnap, r.state, {});
  assert.equal(a.step.block_key, 'name_confirm');
  assert.equal(a.step.text, 'This is what we read from your identity document. Is it correct?');
  assert.deepEqual(a.step.facts.map((f) => f.value), ['John Carter', '14 March 1987', 'United Kingdom', 'Passport GBR, valid until 2 September 2031']);
});

test('in review: datapoints flagged, a neutral message, the conversation continues', () => {
  const a = E.advance(npSnap, E.initialState(), {});
  const r = E.applyAnswer(npSnap, a.state, a.step, { session_done: true }, { idv: idvFromItem(approvedItem), idv_outcome: 'in_review' });
  assert.equal(r.state.datapoints.full_name.status, 'in_review');
  assert.ok(r.messages.some((m) => /colleague will look/.test(m.text)));
  assert.equal(E.advance(npSnap, r.state, {}).step.block_key, 'name_confirm');
});

test('"Not now": block.declined, a neutral reply and the ID step again', () => {
  const a = E.advance(npSnap, E.initialState(), {});
  const r = E.applyAnswer(npSnap, a.state, a.step, { declined: true }, {});
  assert.equal(r.reask, true);
  assert.equal(r.clientText, 'Not now');
  assert.ok(r.events.some((e) => e.event === 'block.declined'));
  assert.equal(r.state.block_states.idv.state, 'declined');
  const again = E.advance(npSnap, r.state, {});
  assert.equal(again.step.block_key, 'idv');
  assert.notEqual(again.step.id, a.step.id); // a new step id, so an old answer is refused as not current
  assert.ok(E.validateAnswer(a.step, { stub: true })); // the phase-3 stand-in answer is no longer accepted
});

test('related-party template: 8 blocks, {company} and {role_text} filled, pep in section contact, progress 8', () => {
  const t = seed.templates.find((x) => x.key === 'related_party_np');
  assert.ok(t);
  const snap = buildSnapshot({ template: t, blocks: seed.blocks });
  assert.equal(E.progress(snap, E.initialState()).total, 8);
  const intro = (t.intro_messages || []).map((m) => fillPlaceholders(m, { first_name: 'Anna', company: 'Carter Holding B.V.', role_text: 'director' }));
  assert.equal(intro[0], 'Hi Anna, Carter Holding B.V. has asked you to complete your own details as director.');
  const pepItem = snap.template_snapshot.items.find((i) => i.block_key === 'pep');
  assert.equal(pepItem.section_key || snap.blocks_snapshot.pep.section_key, 'contact');
  const script = {
    idv: { session_done: true }, name_confirm: 'Yes, this is correct',
    address: { country: 'Netherlands', postcode: '1011 AB', number: '1', street: 'Damrak', city: 'Amsterdam' },
    email: 'Yes, that is correct', phone: { code: '+31', number: '612345678' }, pep: 'No', review: 'confirmed',
    sign: { terms: true, typed_name: 'john carter', signature: 'data:image/png;base64,x' },
  };
  let s = E.initialState();
  const asked = [];
  for (let i = 0; i < 30; i++) {
    const a = E.advance(snap, s, { invitation_email: 'anna@example.com' });
    s = a.state;
    if (a.done) break;
    asked.push(a.step.block_key);
    const k = a.step.kind === 'follow_up' ? `${a.step.block_key}:${a.step.fu_id}` : a.step.block_key;
    const r = E.applyAnswer(snap, s, a.step, script[k], { idv: idvFromItem(approvedItem), idv_outcome: 'approved', invitation_email: 'anna@example.com' });
    if (r.error) throw new Error(`${k}: ${r.error}`);
    s = r.state;
  }
  assert.deepEqual(asked, ['idv', 'name_confirm', 'address', 'email', 'phone', 'pep', 'review', 'sign']);
  assert.equal(E.progress(snap, s, { submitted: true }).pct, 100);
});

test('widget and portal: QR above 760 px, button below; no stand-in left; the page calls outreachPortal only', () => {
  const w = readFileSync(new URL('../src/components/outreachconv/widgets/Idv.jsx', import.meta.url), 'utf8');
  assert.match(w, /Math\.min\(window\.innerWidth, window\.screen\?\.width \|\| window\.innerWidth\) > 760/);
  assert.match(w, /continueDidit/);
  assert.match(w, /QRCode\.toDataURL/);
  const portal = readFileSync(new URL('../base44/functions/outreachPortal/entry.ts', import.meta.url), 'utf8');
  assert.ok(!/idvFromClient/.test(portal));
  assert.match(portal, /functions\.invoke\('createDiditSession'/);
  assert.match(portal, /functions\.invoke\('getDiditSessionResult'/);
  assert.match(portal, /block\.declined|declined: true/);
  for (const f of ['src/pages/OutreachConversation.jsx', 'src/components/outreachconv/widgets/Idv.jsx']) {
    const src = readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
    assert.ok(!/createDiditSession|getDiditSessionResult|base44\.entities/.test(src), f);
  }
});
