// Phase 8: an organisation conversation end to end — scenario C (NL, KvK, Low risk) through profile, documents,
// representative ID check, review and signature; AT 25 (sole), AT 30 (name mismatch), AT 33 (pending parties), progress 19.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildSeed } from '../base44/shared/outreachSeed.js';
import { OUTREACH_BLOCK_LIBRARY, OUTREACH_FORM_TEMPLATES } from '../base44/shared/outreachPack.js';
import { buildSnapshot, initialProgressTotal, fillPlaceholders } from '../base44/shared/outreachSnapshot.js';
import { normName } from '../base44/shared/outreachUbo.js';
import { MESSAGES } from '../base44/shared/outreachMessages.js';
import * as E from '../base44/shared/outreachEngine.js';

const seed = buildSeed(OUTREACH_BLOCK_LIBRARY, OUTREACH_FORM_TEMPLATES);
const snap = buildSnapshot({ template: seed.templates.find((t) => t.key === 'onboarding_org'), blocks: seed.blocks });
const fixtures = JSON.parse(readFileSync(new URL('../docs/outreach/05-demo-fixtures.json', import.meta.url), 'utf8'));
const k1 = fixtures.kvk_search_fixtures.find((x) => x.id === 'k1');
const vars = { tenant_name: 'New Age Bank', first_name: 'Emma', ownerListThreshold: 10, uboThreshold: 25, legalFormOptions: ['Besloten vennootschap (B.V.)', 'Other'], registrySearchLimit: 3, releaseInvitesAfterIdv: true };
const pass = (names) => names.map((n) => ({ name: n, ok: true }));
const up = (name, checks) => ({ evidence_id: 'ev', name, size: 1, mime: 'application/pdf', checks });
const SELECTED = { legal_name: k1.name, reg_no: k1.kvk, rsin: k1.rsin, legal_form: k1.form, co_status: k1.status, co_address: k1.address, sbi: k1.sbi, reg_date: k1.reg, trade_name: k1.trade, officers: k1.dirs.map((d) => ({ name: d.name, role: d.role, authority_text: d.auth })), parent: k1.parent };
const IDV = { full_name: 'Emma Clarke', dob: '2 June 1984', nat: 'United Kingdom', doc: 'Passport GBR, valid until 11 May 2030' };

const SCRIPT = {
  purpose_org: ['Day-to-day business payments', 'Receiving customer payments'], nature_org: ['Business current account', 'Debit cards'],
  activity: 'Yes, that is accurate', countries_org: ['Netherlands', 'Asia'], 'countries_org:outside': 'Suppliers in Turkey and Suriname, about 8 payments per month.',
  volume: 'Over € 1 million', 'volume:high': 'Seasonal container shipments for three large customers.',
  sof_org: ['Revenue from customers', 'Shareholder funding'], 'sof_org:loan': up('shareholder-loan-agreement.pdf', pass(['Readable and complete'])),
  sow_ubo: 'Built the company from 2014, plus salary and a property sale in 2021.',
  docs: up('shareholder-register.pdf', pass(['Readable and complete'])), name_confirm: 'Yes, this is correct', pep: 'No', review: 'confirmed', review_org: 'confirmed',
  sign_org: { terms: true, typed_name: 'Emma Clarke', signature: 'data:image/png;base64,x' },
};

function run({ who = 'Emma Clarke', idv = IDV, risk = 'low', legalForm = null, owners, chain } = {}) {
  let s = E.initialState({ risk });
  const lines = []; const audit = []; let released = null;
  const sel = legalForm ? { ...SELECTED, legal_form: legalForm } : SELECTED;
  const own = owners || [{ type: 'company', name: 'Harbour Logistics Holding B.V.', pct: 60 }, { type: 'person', name: 'Emma Clarke', pct: 25 }, { type: 'person', name: 'David Okoye', pct: 15 }];
  const ch = chain || { 'Harbour Logistics Holding B.V.': [{ type: 'person', name: 'Emma Clarke', pct: 50 }, { type: 'person', name: 'Tom Becker', pct: 50 }] };
  for (let i = 0; i < 120; i++) {
    let a = E.advance(snap, s, vars);
    while (a.needs_phrasing) a = E.advance(snap, E.setPhrasing(a.state, { text: a.needs_phrasing.default_text, ai: true, mode: 'auto' }), vars);
    s = a.state;
    a.events.forEach((e) => audit.push(e.event));
    a.messages.forEach((m) => lines.push([m.kind === 'structure_card' ? 'CARD0' : 'BANK', m.text, m.tag || null]));
    if (a.done) {
      const pending = (s.datapoints.invites?.value || []);
      E.submissionMessages({ first_name: 'Emma', response_time: '2 working days', reference: 'NAB-2026-ORG-0412', company: s.datapoints.legal_name.display, pending }).forEach((m) => lines.push([m.kind === 'status_card' ? 'CARD' : 'BANK', m.text]));
      return { s, lines, audit, released };
    }
    if (a.paused) throw new Error('paused');
    const st = a.step;
    const k = st.kind === 'follow_up' ? `${st.block_key}:${st.fu_id}` : st.block_key;
    let val;
    if (st.block_key === 'country') val = 'Netherlands';
    else if (st.block_key === 'registry' && st.sub === 'search') { s = { ...s, reg: { ...s.reg, selected: sel } }; val = { selected: true }; }
    else if (st.block_key === 'registry') val = st.options?.[0] || up('x.pdf', pass(st.checks || []));
    else if (st.block_key === 'directors') val = st.people;
    else if (k === 'authreps') val = 'Yes, there are others';
    else if (st.block_key === 'authreps' && st.widget === 'people_list') val = [{ name: 'Anna Visser', authority: 'May sign jointly' }];
    else if (st.block_key === 'authreps') val = up('power-of-attorney-anna-visser.pdf', pass(st.checks));
    else if (st.fu_id === 'company_match') val = 'Yes, same company';
    else if (st.fu_id === 'company_owners') val = ch[st.company];
    else if (k === 'owners') val = own;
    else if (k === 'ubo') val = 'Yes, this is complete';
    else if (st.block_key === 'invites' && st.sub === 'who') val = who;
    else if (st.block_key === 'invites' && st.fu_id === 'role') val = 'Office manager';
    else if (st.block_key === 'invites') val = 'sent';
    else if (k === 'rep') val = { session_done: true };
    else if (k === 'sign_org') val = { ...SCRIPT.sign_org, typed_name: s.datapoints.full_name?.display };
    else val = SCRIPT[k];
    if (val === undefined) throw new Error(`no answer for ${k}`);
    const r = E.applyAnswer(snap, s, st, val, { vars, kvkMode: 'test', diditConfigured: true, idv, idv_outcome: 'approved', companyMatches: { [normName('Harbour Logistics Holding B.V.')]: { number: '81234568', name: 'Harbour Logistics Holding B.V.' } } });
    if (r.error) throw new Error(`${k}: ${r.error}`);
    s = r.state;
    lines.push(['CLIENT', r.clientText]);
    r.messages.forEach((m) => lines.push(['BANK', m.text, m.tag || null]));
    r.events.forEach((e) => audit.push(e.event));
    if (r.release_invites) {
      // what the portal does: release the queued invitations and say so
      released = s.datapoints.invites?.value || [];
      lines.push(['BANK', released.length ? fillPlaceholders(MESSAGES.repVerifiedInvites, { names: E.joinNames(released) }) : MESSAGES.repVerified, MESSAGES.invitationsSentTag]);
    }
    if (r.rep_flag) audit.push('analyst.alerted');
  }
  throw new Error('did not finish');
}

function transcriptC() {
  const t = readFileSync(new URL('../docs/outreach/06-conversation-transcripts.txt', import.meta.url), 'utf8');
  const c = t.slice(t.indexOf('SCENARIO C:'), t.indexOf('SCENARIO C2'));
  const body = c.slice(0, c.indexOf('DATAPOINTS COLLECTED'));
  return body.split('\n').filter((l) => l.startsWith('BANK ')).map((l) => l.slice(4).trim().replace(/^\[[^\]]+\]\s*/, '').replace(/^ED \/ /, '')).slice(2);
}

test('ORG progress total is 19 at Low risk (spec 5.5)', () => {
  assert.equal(initialProgressTotal(snap, { risk: 'low' }), 19);
  assert.equal(E.progress(snap, E.initialState({ risk: 'low' })).total, 19);
});

test('scenario C end to end: every bank line as in the transcript, up to the submission', () => {
  const { lines, released, s } = run();
  const bank = lines.filter((l) => l[0] === 'BANK').map((l) => l[1].replace(/\n/g, ' / '));
  assert.deepEqual(bank, transcriptC());
  assert.deepEqual(released, ['David Okoye', 'Tom Becker', 'Anna Visser']);
  assert.equal(E.progress(snap, s, { submitted: true }).pct, 100);
});

test('AT 33: the status card lists the parties that are still pending; case.submitted after signing', () => {
  const { lines, audit } = run();
  const card = lines.find((l) => l[0] === 'CARD');
  assert.match(card[1], /^We are still waiting for David Okoye, Tom Becker and Anna Visser to complete their own checks\. We will review/);
  assert.ok(audit.includes('rep.verified'));
  assert.ok(audit.indexOf('rep.verified') < audit.lastIndexOf('block.asked'));
});

test('AT 30: the name on the ID differs from the declared representative -> message, rep_flag, analyst alerted', () => {
  const { lines, s, audit } = run({ idv: { ...IDV, full_name: 'Emily Clark' } });
  assert.ok(lines.some((l) => l[1] === 'The name on your ID (Emily Clark) differs from the person you selected (Emma Clarke). A colleague will check this. You can simply continue.'));
  assert.deepEqual(s.datapoints.rep_flag.value, { declared: 'Emma Clarke', id_name: 'Emily Clark' });
  assert.ok(audit.includes('rep.match') && audit.includes('analyst.alerted'));
});

test('AT 25: a sole proprietorship skips the documents block with the reason', () => {
  const { audit, s } = run({ legalForm: 'Eenmanszaak', owners: [{ type: 'person', name: 'Emma Clarke', pct: 100 }] });
  assert.equal(s.block_states.docs.state, 'skipped');
  assert.ok(audit.includes('block.skipped'));
  assert.ok(!s.datapoints.o_register);
});

test('at Medium risk the source of wealth of the first UBO is asked', () => {
  const t = run({ risk: 'medium' });
  // the run would throw on a missing answer; make sure the question was the UBO one
  assert.ok(t.lines.some((l) => /we also ask about Emma Clarke: how did they build their wealth/.test(l[1] || '')));
});
