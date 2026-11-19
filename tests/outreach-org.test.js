// Phase 6a: an organisation through the document route — scenario D of 06-conversation-transcripts.txt up to the UBO step.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildSeed } from '../base44/shared/outreachSeed.js';
import { OUTREACH_BLOCK_LIBRARY, OUTREACH_FORM_TEMPLATES } from '../base44/shared/outreachPack.js';
import { buildSnapshot } from '../base44/shared/outreachSnapshot.js';
import * as E from '../base44/shared/outreachEngine.js';

const seed = buildSeed(OUTREACH_BLOCK_LIBRARY, OUTREACH_FORM_TEMPLATES);
const snap = buildSnapshot({ template: seed.templates.find((t) => t.key === 'onboarding_org'), blocks: seed.blocks });
const vars = { tenant_name: 'New Age Bank', first_name: 'Emma', ownerListThreshold: 10, uboThreshold: 25, pause_before: ['invites'] };
const pass = (names) => names.map((n) => ({ name: n, ok: true }));
const READ = {
  legal_name: 'Blue Coral Partners V.O.F.', registration_number: 'CW-166540', legal_form: 'Vennootschap onder firma (V.O.F.)', status: 'Active (per extract)',
  registered_address: 'Schottegatweg Oost 12, Willemstad, Curaçao', activity: 'Import and wholesale of marine equipment', registration_date: '9 February 2019',
  officers: [{ name: 'Emma Clarke', role: 'Managing partner' }, { name: 'Tom Becker', role: 'Managing partner' }],
};
const upload = (name, checks, read) => ({ evidence_id: 'ev', name, size: 1, mime: 'application/pdf', checks, ...(read ? { read } : {}) });

function runD({ owners, chain = {}, ubo = 'Yes, this is complete', extraVars = {}, country = 'Curaçao', blocked = [] } = {}) {
  let s = E.initialState({ risk: 'high' });
  const lines = []; const audit = []; let extracts = 0;
  const v = { ...vars, ...extraVars };
  for (let i = 0; i < 60; i++) {
    let a = E.advance(snap, s, v);
    while (a.needs_phrasing) a = E.advance(snap, E.setPhrasing(a.state, { text: a.needs_phrasing.default_text, ai: false, mode: 'auto' }), v);
    s = a.state;
    a.events.forEach((e) => audit.push(e.event));
    a.messages.forEach((m) => lines.push([m.kind === 'structure_card' ? 'CARD' : 'BANK', m.text, m.tag || null, m]));
    if (a.paused || a.done) return { s, lines, audit, paused: !!a.paused };
    const st = a.step;
    let val;
    if (st.block_key === 'country') val = country;
    else if (st.block_key === 'registry') {
      if (st.sub === 'extract') val = extracts++ === 0 ? upload('trade-register-extract.pdf', [{ name: 'Readable and complete', ok: true }, { name: 'Issued by a trade register or Chamber of Commerce', ok: true }, { name: 'Not older than 3 months', ok: false }]) : upload('trade-register-extract.pdf', pass(st.checks), READ);
      else if (st.sub === 'confirm') val = 'Yes, this is correct';
      else val = upload('articles-of-association.pdf', pass(st.checks));
    } else if (st.block_key === 'directors') val = st.people;
    else if (st.block_key === 'authreps' && st.kind === 'block') val = 'Yes, there are others';
    else if (st.block_key === 'authreps' && st.widget === 'people_list') val = [{ name: 'Anna Visser', authority: 'May sign jointly', note: 'Finance manager' }];
    else if (st.block_key === 'authreps') val = upload('power-of-attorney-anna-visser.pdf', pass(st.checks));
    else if (st.block_key === 'owners' && st.fu_id === 'company_reg') val = 'Netherlands, KvK 12345678';
    else if (st.block_key === 'owners' && st.fu_id === 'company_owners') val = chain[st.company];
    else if (st.block_key === 'owners') val = owners;
    else if (st.block_key === 'ubo' && st.kind === 'block') val = ubo;
    else if (st.block_key === 'ubo') val = 'Through voting rights';
    else throw new Error(`unexpected step ${st.block_key}`);
    const r = E.applyAnswer(snap, s, st, val, { vars: v, blockedJurisdictions: blocked, diditConfigured: false }); // transcript D is the document route (no Didit)
    if (r.error) throw new Error(`${st.block_key}: ${r.error}`);
    s = r.state;
    lines.push(['CLIENT', r.clientText]);
    r.messages.forEach((m) => lines.push(['BANK', m.text, m.tag || null]));
    r.events.forEach((e) => audit.push(e.event));
  }
  throw new Error('did not finish');
}

function transcriptDUntilUbo() {
  const t = readFileSync(new URL('../docs/outreach/06-conversation-transcripts.txt', import.meta.url), 'utf8');
  const d = t.slice(t.indexOf('SCENARIO D:'), t.indexOf('SCENARIO D2'));
  const lines = d.split('\n').filter((l) => l.startsWith('BANK ')).map((l) => l.slice(4).trim().replace(/^\[[^\]]+\]\s*/, '').replace(/^ED \/ /, ''));
  const end = lines.findIndex((l) => l.startsWith('Based on what you told us'));
  return lines.slice(2, end + 1);
}
const PARTNERS = [{ type: 'person', name: 'Emma Clarke', pct: 70 }, { type: 'person', name: 'Tom Becker', pct: 30 }];

test('scenario D up to the UBO step: every bank line as in the transcript, then the ORG pause', () => {
  const { lines, paused } = runD({ owners: PARTNERS });
  assert.equal(paused, true);
  assert.deepEqual(lines.filter((l) => l[0] === 'BANK').map((l) => l[1]), transcriptDUntilUbo());
});

test('scenario D: datapoints and sources as in the transcript', () => {
  const { s } = runD({ owners: PARTNERS });
  const d = (k) => [s.datapoints[k]?.display, s.datapoints[k]?.source];
  assert.deepEqual(d('country'), ['Curaçao', 'rep']);
  assert.deepEqual(d('legal_name'), ['Blue Coral Partners V.O.F.', 'doc']);
  assert.deepEqual(d('reg_no'), ['CW-166540', 'doc']);
  assert.deepEqual(d('doc_articles'), ['articles-of-association.pdf', 'doc']);
  assert.deepEqual(d('directors'), ['Emma Clarke (Managing partner), Tom Becker (Managing partner)', 'doc']);
  assert.deepEqual(d('authreps'), ['Anna Visser (May sign jointly, Finance manager)', 'rep']);
  assert.deepEqual(d('auth_doc_anna_visser'), ['power-of-attorney-anna-visser.pdf', 'doc']);
  assert.deepEqual(d('owners'), ['Emma Clarke 70%, Tom Becker 30%', 'rep']);
  assert.deepEqual(d('ubos'), ['Emma Clarke (70%), Tom Becker (30%)', 'calc']);
  assert.equal(s.legal_form_kind, 'partnership');
});

test('scenario D: audit order of the registry part, structure card before the UBO question', () => {
  const { audit, lines } = runD({ owners: PARTNERS });
  const reg = audit.slice(audit.indexOf('route.selected'), audit.indexOf('ubo.calculated') + 1);
  assert.deepEqual(reg.slice(0, 8), ['route.selected', 'block.answered', 'block.asked', 'doc.checked', 'rule', 'block.asked', 'doc.checked', 'ai.document.read']);
  const card = lines.findIndex((l) => l[0] === 'CARD');
  assert.ok(card > 0 && lines[card + 1][1].startsWith('Based on what you told us'));
  assert.match(lines[card][1], /Emma Clarke 70% \(UBO 70%\)/);
});

test('holding structure: company owner -> its registration and owners are asked; Emma 55%, Tom 30%', () => {
  const { s, lines } = runD({
    owners: [{ type: 'company', name: 'Harbour Logistics Holding B.V.', pct: 60 }, { type: 'person', name: 'Emma Clarke', pct: 25 }, { type: 'person', name: 'David Okoye', pct: 15 }],
    chain: { 'Harbour Logistics Holding B.V.': [{ type: 'person', name: 'Emma Clarke', pct: 50 }, { type: 'person', name: 'Tom Becker', pct: 50 }] },
  });
  assert.ok(lines.some((l) => l[1] === 'Where is Harbour Logistics Holding B.V. registered, and what is its registration number?'));
  assert.ok(lines.some((l) => l[1] === 'Who owns Harbour Logistics Holding B.V.? List everyone who holds 10% or more of it.'));
  assert.deepEqual(s.datapoints.ubos.value.ubos, ['Emma Clarke', 'Tom Becker']);
  assert.equal(s.datapoints.ubos.value.shares['Emma Clarke'], 55);
});

test('nobody reaches the threshold: rule records the directors as UBO; "someone else controls" asks who', () => {
  const five = ['A', 'B', 'C', 'D', 'E'].map((n) => ({ type: 'person', name: n, pct: 20 }));
  const { s, audit } = runD({ owners: five });
  assert.deepEqual(s.datapoints.ubos.value.directors_as_ubo, ['Emma Clarke', 'Tom Becker']);
  assert.ok(audit.includes('rule'));
  const c = runD({ owners: PARTNERS, ubo: 'Someone else also controls the organisation' });
  assert.equal(c.s.datapoints.control.display, 'Through voting rights');
});

test('validation of the owners builder and the people list', () => {
  assert.ok(E.validateAnswer({ widget: 'owners_builder' }, [{ name: 'A', pct: 70 }, { name: 'B', pct: 40 }]));
  assert.ok(E.validateAnswer({ widget: 'owners_builder' }, [{ name: 'A', pct: 0 }]));
  assert.equal(E.validateAnswer({ widget: 'owners_builder' }, [{ name: 'A', pct: 60 }]), null);
  assert.ok(E.validateAnswer({ widget: 'people_list' }, []));
});

test('a blocked jurisdiction stops the conversation with the neutral message', () => {
  const { lines, paused } = runD({ owners: PARTNERS, blocked: ['Curaçao'] });
  assert.equal(paused, true);
  assert.ok(lines.some((l) => /cannot open an account for an organisation registered in Curaçao/.test(l[1])));
});
