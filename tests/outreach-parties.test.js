// Phase 7: related parties and invitations (block `invites`) — AT 27, 32, the tracker, scenario C/D lines through `invites`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { inviteParties, roleText } from '../base44/shared/outreachParties.js';
import { inviteTransition, canContinue } from '../base44/shared/outreachInvites.js';
import { buildSeed } from '../base44/shared/outreachSeed.js';
import { OUTREACH_BLOCK_LIBRARY, OUTREACH_FORM_TEMPLATES } from '../base44/shared/outreachPack.js';
import { buildSnapshot } from '../base44/shared/outreachSnapshot.js';
import * as E from '../base44/shared/outreachEngine.js';

const dpC = {
  directors: { value: [{ name: 'Emma Clarke', role: 'Director' }, { name: 'David Okoye', role: 'Director' }] },
  authreps: { value: [{ name: 'Anna Visser', authority: 'May sign jointly' }] },
  owners: { value: [{ type: 'company', name: 'Harbour Logistics Holding B.V.', pct: 60 }, { type: 'person', name: 'Emma Clarke', pct: 25 }, { type: 'person', name: 'David Okoye', pct: 15 }] },
  chain_h: { value: { company: 'Harbour Logistics Holding B.V.', owners: [{ type: 'person', name: 'Emma Clarke', pct: 50 }, { type: 'person', name: 'Tom Becker', pct: 50 }] } },
  ubos: { value: { ubos: ['Emma Clarke', 'Tom Becker'], shares: { 'Emma Clarke': 55, 'Tom Becker': 30, 'David Okoye': 15 } } },
};

test('AT 27: declared Emma -> Emma "Your check comes last", David, Tom and Anna to invite', () => {
  const { rows } = inviteParties(dpC, { repName: 'Emma Clarke' });
  assert.deepEqual(rows.map((r) => [r.name, r.status]), [['Emma Clarke', 'Your check comes last'], ['David Okoye', 'To invite'], ['Tom Becker', 'To invite'], ['Anna Visser', 'To invite']]);
  assert.equal(rows.filter((r) => r.status === 'To invite').length, 3);
});

test('AT 32: "None of these" -> nobody is marked "Your check comes last"', () => {
  const { rows } = inviteParties(dpC, { repName: null });
  assert.ok(rows.every((r) => r.status === 'To invite'));
});

test('owners below the threshold who are not director or representative need no check', () => {
  const dp = { ...dpC, owners: { value: [...dpC.owners.value, { type: 'person', name: 'Small Owner', pct: 12 }] } };
  assert.deepEqual(inviteParties(dp, { repName: 'Emma Clarke' }).belowThreshold, ['Small Owner']);
  assert.equal(roleText(['Director', 'UBO']), 'Director and ultimate beneficial owner');
});

test('AT 28 / 29 / 31 as data: Queued with the setting on, Invited at once with it off, release, completion', () => {
  assert.deepEqual(inviteTransition('To invite', 'send', { releaseAfterIdv: true }), { status: 'Queued', createChild: false });
  assert.deepEqual(inviteTransition('To invite', 'send', { releaseAfterIdv: false }), { status: 'Invited', createChild: true });
  assert.deepEqual(inviteTransition('Queued', 'release'), { status: 'Invited', createChild: true });
  assert.deepEqual(inviteTransition('Invited', 'opened'), { status: 'Opened', createChild: false });
  assert.deepEqual(inviteTransition('Opened', 'completed'), { status: 'Completed', createChild: false });
  assert.equal(inviteTransition('Completed', 'send'), null);
  assert.equal(canContinue([{ status: 'Your check comes last' }, { status: 'Queued' }, { status: 'Invited' }]), true);
  assert.equal(canContinue([{ status: 'To invite' }]), false);
});

// ── through the conversation: scenario D (document route) from the UBO step to the pause before purpose_org ────────
const seed = buildSeed(OUTREACH_BLOCK_LIBRARY, OUTREACH_FORM_TEMPLATES);
const snap = buildSnapshot({ template: seed.templates.find((t) => t.key === 'onboarding_org'), blocks: seed.blocks });
const vars = { tenant_name: 'New Age Bank', first_name: 'Emma', ownerListThreshold: 10, uboThreshold: 25, pause_before: ['purpose_org'], releaseInvitesAfterIdv: true };
const pass = (names) => names.map((n) => ({ name: n, ok: true }));
const READ = { legal_name: 'Blue Coral Partners V.O.F.', registration_number: 'CW-166540', legal_form: 'Vennootschap onder firma (V.O.F.)', status: 'Active (per extract)', registered_address: 'Schottegatweg Oost 12, Willemstad, Curaçao', activity: 'Import and wholesale of marine equipment', registration_date: '9 February 2019', officers: [{ name: 'Emma Clarke', role: 'Managing partner' }, { name: 'Tom Becker', role: 'Managing partner' }] };
const up = (name, checks, read) => ({ evidence_id: 'ev', name, size: 1, mime: 'application/pdf', checks, ...(read ? { read } : {}) });

function runD(who = 'Emma Clarke') {
  let s = E.initialState({ risk: 'high' });
  const lines = []; const audit = []; let ex = 0;
  for (let i = 0; i < 70; i++) {
    let a = E.advance(snap, s, vars);
    while (a.needs_phrasing) a = E.advance(snap, E.setPhrasing(a.state, { text: a.needs_phrasing.default_text, ai: false, mode: 'auto' }), vars);
    s = a.state;
    a.events.forEach((e) => audit.push(e.event));
    a.messages.forEach((m) => lines.push(['BANK', m.text]));
    if (a.paused || a.done) return { s, lines, audit, steps: lines };
    const st = a.step;
    let val;
    if (st.block_key === 'country') val = 'Curaçao';
    else if (st.block_key === 'registry') val = st.sub === 'extract' ? up('x.pdf', pass(st.checks), READ) : st.sub === 'confirm' ? st.options[0] : up('a.pdf', pass(st.checks));
    else if (st.block_key === 'directors') val = st.people;
    else if (st.block_key === 'authreps' && st.kind === 'block') val = 'Yes, there are others';
    else if (st.block_key === 'authreps' && st.widget === 'people_list') val = [{ name: 'Anna Visser', authority: 'May sign jointly', note: 'Finance manager' }];
    else if (st.block_key === 'authreps') val = up('poa.pdf', pass(st.checks));
    else if (st.block_key === 'owners') val = [{ type: 'person', name: 'Emma Clarke', pct: 70 }, { type: 'person', name: 'Tom Becker', pct: 30 }];
    else if (st.block_key === 'ubo') val = 'Yes, this is complete';
    else if (st.block_key === 'invites' && st.sub === 'who') val = who;
    else if (st.block_key === 'invites' && st.fu_id === 'role') val = 'Office manager';
    else if (st.block_key === 'invites') { s = { ...s, tracker_rows: st.parties }; val = 'sent'; }
    else throw new Error(`unexpected ${st.block_key}`);
    const r = E.applyAnswer(snap, s, st, val, { vars, diditConfigured: false });
    if (r.error) throw new Error(`${st.block_key}: ${r.error}`);
    s = r.state;
    lines.push(['CLIENT', r.clientText]);
    r.messages.forEach((m) => lines.push(['BANK', m.text]));
    r.events.forEach((e) => audit.push(e.event));
  }
  throw new Error('did not finish');
}

test('scenario D through `invites`: the two invite questions as in the transcript; rep_role and invites datapoints', () => {
  const t = readFileSync(new URL('../docs/outreach/06-conversation-transcripts.txt', import.meta.url), 'utf8');
  const d = t.slice(t.indexOf('SCENARIO D:'), t.indexOf('SCENARIO D2')).split('\n').filter((l) => l.startsWith('BANK ')).map((l) => l.slice(4).trim());
  const want = d.slice(d.findIndex((l) => l.startsWith('Before we continue')), d.findIndex((l) => l.startsWith('Each person below')) + 1);
  const { lines, s, audit } = runD();
  const bank = lines.filter((l) => l[0] === 'BANK').map((l) => l[1].replace(/\n/g, ' / '));
  const from = bank.findIndex((l) => l.startsWith('Before we continue'));
  assert.deepEqual(bank.slice(from, from + want.length), want);
  assert.equal(s.datapoints.rep_role.display, 'Emma Clarke (Managing partner). To be verified by ID check at the end');
  assert.equal(s.datapoints.invites.display, 'Tom Becker, Anna Visser');
  assert.equal(s.datapoints.invites.source, 'calc');
  assert.ok(audit.includes('rep.declared'));
});

test('AT 32 in the conversation: "None of these" asks the role and marks nobody as the representative', () => {
  const { lines, s } = runD('None of these');
  assert.ok(lines.some((l) => l[1] === 'What is your role at Blue Coral Partners V.O.F.?'));
  assert.equal(s.datapoints.rep_role.display, 'Office manager');
  assert.equal(s.datapoints.invites.display, 'Emma Clarke, Tom Becker, Anna Visser'); // directors, UBOs, representatives
});

test('the tracker answer is refused while someone is still "To invite" (server side check is in the portal)', () => {
  assert.ok(E.validateAnswer({ widget: 'tracker' }, 'x'));
  assert.equal(E.validateAnswer({ widget: 'tracker' }, 'sent'), null);
});
