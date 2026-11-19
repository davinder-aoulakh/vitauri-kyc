// Phase 6b: company registry — provider table, Didit and KvK mapping, scenario C (KvK), AT 14b (NL via Didit), fallbacks.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pickProvider, fallbackRoute, countryIso2 } from '../base44/shared/outreachRegistryProvider.js';
import { mapDiditCompany, diditSearch, diditSelect, isActiveStatus } from '../base44/shared/outreachAdapters/diditRegistry.js';
import { mapKvkProfile, kvkSearch } from '../base44/shared/outreachAdapters/kvk.js';
import { buildSeed } from '../base44/shared/outreachSeed.js';
import { OUTREACH_BLOCK_LIBRARY, OUTREACH_FORM_TEMPLATES } from '../base44/shared/outreachPack.js';
import { buildSnapshot } from '../base44/shared/outreachSnapshot.js';
import { normName } from '../base44/shared/outreachUbo.js';
import * as E from '../base44/shared/outreachEngine.js';

// Recorded from the tenant's Didit sandbox application on 19 Nov 2026 (free).
const SANDBOX_SEARCH = { request_id: 'd83d307f', kyb_registry: { companies: [{ kyb_response_id: 'sandbox-kyb-response-d83d307f', name: 'Harbour Logistics', registration_number: 'SANDBOX-0001', status: 'active', type: 'Private Limited Company', risk_level: null, fetch_status: 'pending' }], pagination: { total: 1 }, search_status: 'resolved', search_resolved: true } };
const SANDBOX_SELECT = { request_id: '72f3fcc3', registry_tier_delivered: 'basic', kyb_registry: { status: 'Approved', registry_status: 'active', data_resolved: true, company_name: 'Sandbox Holdings Ltd', registration_number: 'SANDBOX-0001', country_code: 'GB', company_type: 'Private Limited Company', incorporation_date: '2010-01-01', registered_address: '1 Sandbox Way, Sandbox City', website: null, phone: null, nature_of_business: null, officers: [], addresses: [{ address: '1 Sandbox Way, Sandbox City' }], fetch_status: 'resolved', registry_data: { sandbox: true } } };
const fakeFetch = (json, status = 200) => async () => ({ ok: status < 400, status, json: async () => json });

test('provider table and fallbacks', () => {
  assert.deepEqual(pickProvider({ country: 'Netherlands', kvkMode: 'test' }).route, 'nl');
  assert.deepEqual(pickProvider({ country: 'Netherlands', kvkMode: 'live' }).route, 'nl');
  assert.deepEqual(pickProvider({ country: 'Netherlands', kvkMode: 'off' }).route, 'didit');
  assert.deepEqual(pickProvider({ country: 'Curaçao', kvkMode: 'test' }).route, 'didit');
  assert.deepEqual(pickProvider({ country: 'Australia' }).route, 'didit');
  assert.deepEqual(pickProvider({ country: 'Atlantis' }).route, 'document');
  assert.deepEqual(pickProvider({ country: 'Curaçao', diditConfigured: false }).route, 'document');
  assert.equal(fallbackRoute('nl'), 'didit');
  assert.equal(fallbackRoute('nl', { diditConfigured: false }), 'document');
  assert.equal(fallbackRoute('didit'), 'document');
  assert.equal(countryIso2('Curaçao'), 'CW');
  assert.equal(countryIso2('Netherlands (NL)'), 'NL');
});

test('Didit adapter on the recorded sandbox responses; website and phone are not kept', async () => {
  const s = await diditSearch({ fetchFn: fakeFetch(SANDBOX_SEARCH), apiKey: 'k', country_code: 'NL', name: 'Harbour' });
  assert.equal(s.ok, true);
  assert.deepEqual(s.candidates[0], { id: 'sandbox-kyb-response-d83d307f', name: 'Harbour Logistics', number: 'SANDBOX-0001', status: 'active', type: 'Private Limited Company', address: '' });
  const sel = await diditSelect({ fetchFn: fakeFetch(SANDBOX_SELECT), apiKey: 'k', kyb_response_id: 'x' });
  assert.equal(sel.sandbox, true);
  assert.deepEqual(sel.company, { legal_name: 'Sandbox Holdings Ltd', reg_no: 'SANDBOX-0001', co_status: 'Active', co_address: '1 Sandbox Way, Sandbox City', co_activity: '', reg_date: '2010-01-01', legal_form_raw: 'Private Limited Company', country_code: 'GB', officers: [] });
  assert.ok(!('website' in sel.company) && !('phone' in sel.company));
  const err = await diditSearch({ fetchFn: fakeFetch({ detail: 'insufficient_credits' }, 403), apiKey: 'k', country_code: 'NL', name: 'x' });
  assert.deepEqual([err.ok, err.error_code], [false, 'forbidden_or_credits']);
  assert.equal(isActiveStatus('Active'), true);
  assert.equal(isActiveStatus('Inactive (dissolved)'), false);
});

test('KvK mapping (Basisprofiel shape) and search', async () => {
  const p = mapKvkProfile({ kvkNummer: '81234567', naam: 'Harbour Logistics B.V.', formeleRegistratiedatum: '20140312', handelsnamen: [{ naam: 'Harbour Logistics' }], sbiActiviteiten: [{ sbiCode: '5229', sbiOmschrijving: 'Other transportation support activities', indHoofdactiviteit: 'Ja' }], _embedded: { eigenaar: { rsin: '862345671', rechtsvorm: 'BesloteVennootschap', uitgebreideRechtsvorm: 'Besloten Vennootschap' }, hoofdvestiging: { adressen: [{ type: 'bezoekadres', volledigAdres: 'Keizersgracht 120 1015CW Amsterdam' }] } } });
  assert.deepEqual([p.reg_no, p.rsin, p.legal_form, p.co_status, p.reg_date, p.trade_name], ['81234567', '862345671', 'Besloten Vennootschap', 'Active', '12-03-2014', 'Harbour Logistics']);
  const s = await kvkSearch({ fetchFn: fakeFetch({ resultaten: [{ kvkNummer: '81234567', naam: 'Harbour Logistics B.V.', adres: { binnenlandsAdres: { plaats: 'Amsterdam' } }, type: 'hoofdvestiging' }] }), mode: 'test', q: 'Harb' });
  assert.deepEqual(s.candidates[0], { id: '81234567', number: '81234567', name: 'Harbour Logistics B.V.', city: 'Amsterdam', status: 'Active', type: 'hoofdvestiging' });
  assert.deepEqual((await kvkSearch({ fetchFn: fakeFetch({}), q: 'H' })).candidates, []);
  assert.equal((await kvkSearch({ fetchFn: fakeFetch({}), mode: 'live', apiKey: '', q: 'Harbour' })).error_code, 'no_key');
});

// ── Engine: scenario C (NL, KvK) and AT 14b (NL via Didit) ────────────────────────────────────────────────
const seed = buildSeed(OUTREACH_BLOCK_LIBRARY, OUTREACH_FORM_TEMPLATES);
const snap = buildSnapshot({ template: seed.templates.find((t) => t.key === 'onboarding_org'), blocks: seed.blocks });
const fixtures = JSON.parse(readFileSync(new URL('../docs/outreach/05-demo-fixtures.json', import.meta.url), 'utf8'));
const k1 = fixtures.kvk_search_fixtures.find((x) => x.id === 'k1');
const vars = { tenant_name: 'New Age Bank', first_name: 'Emma', ownerListThreshold: 10, uboThreshold: 25, pause_before: ['invites'], legalFormOptions: ['Besloten vennootschap (B.V.)', 'Vennootschap onder firma (V.O.F.)', 'Other'], registrySearchLimit: 3 };
const pass = (names) => names.map((n) => ({ name: n, ok: true }));
const up = (name, checks, read) => ({ evidence_id: 'ev', name, size: 1, mime: 'application/pdf', checks, ...(read ? { read } : {}) });

function run({ kvkMode, selected, owners, chain = {}, matches = {}, notFoundFirst = false, extractRead = null }) {
  let s = E.initialState({ risk: 'low' });
  const lines = []; const audit = [];
  let nf = notFoundFirst;
  for (let i = 0; i < 60; i++) {
    let a = E.advance(snap, s, vars);
    while (a.needs_phrasing) a = E.advance(snap, E.setPhrasing(a.state, { text: a.needs_phrasing.default_text, ai: false, mode: 'auto' }), vars);
    s = a.state;
    a.events.forEach((e) => audit.push(e.event));
    a.messages.forEach((m) => lines.push([m.kind === 'structure_card' ? 'CARD' : 'BANK', m.text, m.tag || null]));
    if (a.paused || a.done) return { s, lines, audit };
    const st = a.step;
    let val;
    if (st.block_key === 'country') val = 'Netherlands';
    else if (st.block_key === 'registry' && st.sub === 'search') {
      if (nf) { nf = false; val = { not_found: true }; } else { s = { ...s, reg: { ...s.reg, selected } }; val = { selected: true }; }
    } else if (st.block_key === 'registry' && st.sub === 'confirm_reg') val = st.options[0];
    else if (st.block_key === 'registry' && st.sub === 'legal_form') val = 'Besloten vennootschap (B.V.)';
    else if (st.block_key === 'registry' && (st.sub === 'status_extract' || st.sub === 'extract')) val = up('trade-register-extract.pdf', pass(st.checks), extractRead || { status: 'Active', registration_date: '12 March 2014', legal_name: selected?.legal_name });
    else if (st.block_key === 'registry' && st.sub === 'confirm') val = st.options[0];
    else if (st.block_key === 'registry') val = up('articles.pdf', pass(st.checks));
    else if (st.block_key === 'directors') val = st.people.length ? st.people : [{ name: 'Emma Clarke', role: 'Director' }];
    else if (st.block_key === 'authreps' && st.kind === 'block') val = 'Yes, there are others';
    else if (st.block_key === 'authreps' && st.widget === 'people_list') val = [{ name: 'Anna Visser', authority: 'May sign jointly' }];
    else if (st.block_key === 'authreps') val = up('power-of-attorney-anna-visser.pdf', pass(st.checks));
    else if (st.block_key === 'owners' && st.fu_id === 'company_match') val = 'Yes, same company';
    else if (st.block_key === 'owners' && st.fu_id === 'company_reg') val = 'Netherlands, 81234568';
    else if (st.block_key === 'owners' && st.fu_id === 'company_owners') val = chain[st.company];
    else if (st.block_key === 'owners') val = owners;
    else if (st.block_key === 'ubo') val = 'Yes, this is complete';
    else throw new Error(`unexpected ${st.block_key}/${st.sub}`);
    const r = E.applyAnswer(snap, s, st, val, { vars, kvkMode, diditConfigured: true, companyMatches: matches });
    if (r.error) throw new Error(`${st.block_key}/${st.sub}: ${r.error}`);
    s = r.state;
    lines.push(['CLIENT', r.clientText]);
    r.messages.forEach((m) => lines.push(['BANK', m.text, m.tag || null]));
    r.events.forEach((e) => audit.push(e.event));
  }
  throw new Error('did not finish');
}

const C_SELECTED = { legal_name: k1.name, reg_no: k1.kvk, rsin: k1.rsin, legal_form: k1.form, co_status: k1.status, co_address: k1.address, sbi: k1.sbi, reg_date: k1.reg, trade_name: k1.trade, officers: k1.dirs.map((d) => ({ name: d.name, role: d.role, authority_text: d.auth })), parent: k1.parent };
const C_OWNERS = [{ type: 'company', name: 'Harbour Logistics Holding B.V.', pct: 60 }, { type: 'person', name: 'Emma Clarke', pct: 25 }, { type: 'person', name: 'David Okoye', pct: 15 }];
const C_CHAIN = { 'Harbour Logistics Holding B.V.': [{ type: 'person', name: 'Emma Clarke', pct: 50 }, { type: 'person', name: 'Tom Becker', pct: 50 }] };

function transcriptCUntilUbo() {
  const t = readFileSync(new URL('../docs/outreach/06-conversation-transcripts.txt', import.meta.url), 'utf8');
  const c = t.slice(t.indexOf('SCENARIO C:'), t.indexOf('SCENARIO C2'));
  const lines = c.split('\n').filter((l) => l.startsWith('BANK ')).map((l) => l.slice(4).trim().replace(/^\[[^\]]+\]\s*/, ''));
  return lines.slice(2, lines.findIndex((l) => l.startsWith('Based on what you told us')) + 1);
}

test('scenario C (KvK Test): every bank line up to the UBO question as in the transcript', () => {
  const { lines, s, audit } = run({ kvkMode: 'test', selected: C_SELECTED, owners: C_OWNERS, chain: C_CHAIN, matches: { [normName('Harbour Logistics Holding B.V.')]: { number: '81234568', name: 'Harbour Logistics Holding B.V.' } } });
  assert.deepEqual(lines.filter((l) => l[0] === 'BANK').map((l) => l[1]), transcriptCUntilUbo());
  assert.equal(s.datapoints.legal_name.source, 'kvk');
  assert.equal(s.datapoints.rsin.display, '862345671');
  assert.equal(s.datapoints.directors.source, 'prop');
  assert.equal(s.datapoints.chain_harbour_logistics_holding_b_v.value.registration, 'KvK 81234568'); // from the trade register; the owners are declared (rep)
  assert.deepEqual(s.datapoints.ubos.value.ubos, ['Emma Clarke', 'Tom Becker']);
  assert.ok(audit.includes('route.selected'));
});

test('AT 14b: NL with KvK off goes through Didit; the legal form is asked; no status -> the extract is asked', () => {
  const sel = { legal_name: 'Harbour Logistics B.V.', reg_no: '81234567', co_status: '', co_address: 'Keizersgracht 120, Amsterdam', co_activity: '', reg_date: '', officers: [{ name: 'Emma Clarke', role: 'Principal' }] };
  const { lines, s } = run({ kvkMode: 'off', selected: sel, owners: [{ type: 'person', name: 'Emma Clarke', pct: 100 }] });
  assert.ok(lines.some((l) => l[1] === 'What is the legal form of your organisation?'));
  assert.ok(lines.some((l) => /did not give us the status/.test(l[1])));
  assert.equal(s.datapoints.legal_name.source, 'didit_reg');
  assert.equal(s.datapoints.legal_form.source, 'rep');
  assert.equal(s.datapoints.co_status.display, 'Active');
  assert.equal(s.datapoints.co_status.source, 'doc');
  assert.equal(s.legal_form_kind, 'company');
});

test('an inactive company stops with the message and asks again; "I cannot find my organisation" falls back', () => {
  const k3 = fixtures.kvk_search_fixtures.find((x) => x.id === 'k3');
  let s = E.initialState();
  let a = E.advance(snap, s, vars);
  s = E.applyAnswer(snap, a.state, a.step, 'Netherlands', { vars, kvkMode: 'test' }).state;
  a = E.advance(snap, s, vars);
  assert.equal(a.step.provider, 'kvk');
  s = { ...a.state, reg: { ...a.state.reg, selected: { legal_name: k3.name, reg_no: k3.kvk, co_status: k3.status } } };
  const r = E.applyAnswer(snap, s, a.step, { selected: true }, { vars, kvkMode: 'test' });
  assert.match(r.messages[0].text, /lists Harbourview Hotels B\.V\. as inactive \(dissolved\)/);
  const again = E.advance(snap, r.state, vars);
  assert.equal(again.step.sub, 'search');
  const f = E.applyAnswer(snap, again.state, again.step, { not_found: true }, { vars, kvkMode: 'test' });
  assert.equal(f.state.route, 'didit');
  assert.ok(f.events.some((e) => e.event === 'route.fallback'));
  const f2 = E.applyAnswer(snap, E.advance(snap, f.state, vars).state, E.advance(snap, f.state, vars).step, { not_found: true }, { vars });
  assert.equal(f2.state.route, 'document');
  assert.equal(E.advance(snap, f2.state, vars).step.sub, 'extract');
});

test('source: the client page calls the registry function only through outreachRegistry; no key in adapter logs', () => {
  const fn = readFileSync(new URL('../base44/functions/outreachRegistry/entry.ts', import.meta.url), 'utf8');
  assert.match(fn, /OutreachAdapterCall\.create/);
  assert.ok(!/api_key:|apiKey: (diditKey|secret)[^,]*,\s*\n?\s*\}\)\.catch/.test(fn.slice(fn.indexOf('logCall'), fn.indexOf('const save'))));
  assert.match(fn, /registrySearchLimit/);
  const page = readFileSync(new URL('../src/pages/OutreachConversation.jsx', import.meta.url), 'utf8');
  assert.match(page, /functions\.invoke\('outreachRegistry'/);
});
