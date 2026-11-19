// Phase 6a: UBO calculation (outreachUbo.js) against the vectors of docs/outreach/05-demo-fixtures.json; legal form; parties.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { effectiveShares, ubos, structureTree, structureText } from '../base44/shared/outreachUbo.js';
import { legalFormKind } from '../base44/shared/outreachLegalForm.js';
import { partiesOf, relationRows } from '../base44/shared/outreachParties.js';

const fixtures = JSON.parse(readFileSync(new URL('../docs/outreach/05-demo-fixtures.json', import.meta.url), 'utf8'));

for (const v of fixtures.ubo_test_vectors) {
  test(`UBO vector: ${v.name}`, () => {
    const shares = effectiveShares({ owners: v.owners, chain: v.chain });
    for (const [n, pct] of Object.entries(v.expected_effective)) assert.equal(shares[n], pct, n);
    if (v.expected_ubo) assert.deepEqual([...ubos(shares, v.threshold)].sort(), [...v.expected_ubo].sort());
  });
}

test('thresholds 30 and 31 on the holding structure (Tom Becker has 30.0)', () => {
  const v = fixtures.ubo_test_vectors[0];
  const s = effectiveShares({ owners: v.owners, chain: v.chain });
  assert.deepEqual(ubos(s, 30), ['Emma Clarke', 'Tom Becker']);
  assert.deepEqual(ubos(s, 31), ['Emma Clarke']);
});

test('structure tree and its text alternative', () => {
  const v = fixtures.ubo_test_vectors[0];
  const t = structureTree({ entity: v.entity, owners: v.owners, chain: v.chain, directors: ['Emma Clarke'], threshold: 25 });
  assert.equal(t.owners[0].type, 'company');
  assert.equal(t.owners[0].owners.length, 2);
  assert.ok(t.owners[1].ubo);
  assert.match(structureText(t), /Emma Clarke 25% \(UBO 55%\)/);
  assert.match(structureText(t), /Directors: Emma Clarke/);
});

test('legal form kind', () => {
  assert.equal(legalFormKind('Besloten vennootschap (B.V.)'), 'company');
  assert.equal(legalFormKind('N.V.'), 'company');
  assert.equal(legalFormKind('Vennootschap onder firma'), 'partnership');
  assert.equal(legalFormKind('Blue Coral Partners V.O.F.'), 'partnership');
  assert.equal(legalFormKind('Commanditaire vennootschap'), 'partnership');
  assert.equal(legalFormKind('C.V.'), 'partnership');
  assert.equal(legalFormKind('Eenmanszaak'), 'sole');
  assert.equal(legalFormKind('Sole proprietorship'), 'sole');
  assert.equal(legalFormKind(''), null);
  assert.equal(legalFormKind('Private limited company'), 'company');
});

test('parties: one person, several roles; relation rows', () => {
  const dp = {
    directors: { value: [{ name: 'Emma Clarke', role: 'Director', authority: 'May sign alone' }, { name: 'Tom Becker', role: 'Director' }], source: 'prop' },
    authreps: { value: [{ name: 'Anna Visser', authority: 'May sign jointly' }] },
    owners: { value: [{ type: 'person', name: 'Emma Clarke', pct: 70 }, { type: 'person', name: 'Tom Becker', pct: 30 }] },
    ubos: { value: { ubos: ['Emma Clarke', 'Tom Becker'], shares: { 'Emma Clarke': 70, 'Tom Becker': 30 } } },
  };
  const p = partiesOf(dp);
  assert.equal(p.length, 3);
  assert.deepEqual(p.find((x) => x.name === 'Emma Clarke').roles, ['Director', 'Shareholder', 'UBO']);
  assert.deepEqual(p.find((x) => x.name === 'Anna Visser').roles, ['Authorized Signatory']);
  const rows = relationRows({ entity: 'Blue Coral Partners V.O.F.', dp });
  assert.equal(rows.filter((r) => r.relation === 'ubo').length, 2);
  assert.equal(rows.find((r) => r.relation === 'authorised_representative').authority, 'May sign jointly');
});
