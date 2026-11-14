import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nowFor, parseAsOf, mayOverrideNow, ageInDays } from '../base44/shared/tmNow.js';
import { loadSample, AS_OF } from './helpers/sample.js';

const REAL = new Date('2026-12-24T10:00:00Z');
const real = () => REAL;

test('as_of is honoured for a Demo tenant', () => {
  assert.equal(nowFor({ status: 'Demo' }, { as_of: AS_OF }, { role: 'Analyst' }, real).toISOString(), '2026-11-03T23:59:59.999Z');
});

test('as_of is honoured for a Vitauri Ops caller on an Active tenant', () => {
  assert.equal(nowFor({ status: 'Active' }, { as_of: AS_OF }, { role: 'Vitauri Ops' }, real).toISOString().slice(0, 10), AS_OF);
});

test('as_of is ignored for an Active tenant and a normal role', () => {
  for (const role of ['Tenant Admin', 'Compliance Admin', 'Analyst', undefined]) {
    assert.equal(nowFor({ status: 'Active' }, { as_of: AS_OF }, { role }, real), REAL);
  }
  assert.equal(nowFor(null, { as_of: AS_OF }, null, real), REAL);
});

test('missing or invalid as_of gives the real time, also on a Demo tenant', () => {
  for (const v of [undefined, null, '', 'yesterday', '03-11-2026', 20261103, '2026-13-45']) {
    assert.equal(nowFor({ status: 'Demo' }, { as_of: v }, { role: 'Analyst' }, real), REAL, String(v));
  }
  assert.equal(nowFor({ status: 'Demo' }, undefined, undefined, real), REAL);
});

test('a full ISO timestamp is taken as given', () => {
  assert.equal(parseAsOf('2026-11-03T08:30:00Z').toISOString(), '2026-11-03T08:30:00.000Z');
});

test('mayOverrideNow', () => {
  assert.equal(mayOverrideNow({ status: 'Demo' }, {}), true);
  assert.equal(mayOverrideNow({ status: 'Suspended' }, { role: 'Tenant Admin' }), false);
});

test('without arguments nowFor returns the current time', () => {
  const before = Date.now();
  const t = nowFor({ status: 'Active' }, {}).getTime();
  assert.ok(t >= before && t <= Date.now());
});

// Phase 1 target (gap G2), computed here only: with today = 3 Nov 2026 and a 30-day window,
// 8 sample rows are historical and 10 are recent.
test('sample at as_of 2026-11-03, window 30 days: 8 historical, 10 recent', () => {
  const now = nowFor({ status: 'Demo' }, { as_of: AS_OF }, null, real);
  const { parsed } = loadSample();
  const ages = parsed.rows.map((r) => ageInDays(r.date, now));
  assert.ok(ages.every((a) => a !== null));
  assert.equal(ages.filter((a) => a > 30).length, 8);
  assert.equal(ages.filter((a) => a <= 30).length, 10);
});

test('on the real calendar from 25 Nov 2026 every sample row is older than 30 days', () => {
  const { parsed } = loadSample();
  assert.ok(parsed.rows.every((r) => ageInDays(r.date, new Date('2026-11-25T12:00:00Z')) > 30));
});
