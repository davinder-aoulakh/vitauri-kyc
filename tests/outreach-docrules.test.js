// Phase 5: document checks (outreachDocRules.js) — rules for age, name and address; AI results for the rest.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normaliseChecks, ruleChecks, combineChecks, monthsBetween, nameMatches, addressMatches, failedNames, evidenceStatus } from '../base44/shared/outreachDocRules.js';

const CHECKS = ['Readable and complete', 'Name matches your ID', 'Address matches what you entered', 'Not older than 3 months'];
const addr = { country: 'United Kingdom', postcode: 'N1 9GU', number: '263', street: 'Upper Street', city: 'London' };
const ctx = { today: '2026-11-03', id_name: 'John Carter', address: addr, max_age_months: 3 };

test('the age text follows the tenant setting', () => {
  assert.deepEqual(normaliseChecks(CHECKS, { documentMaxAgeMonths: 6 }).slice(-1), ['Not older than 6 months']);
  assert.deepEqual(normaliseChecks(['Not older than 3 months'], { documentMaxAgeMonths: 1 }), ['Not older than 1 month']);
  assert.deepEqual(normaliseChecks(CHECKS, {}), CHECKS);
});

test('age: inside and outside the limit, missing date pending', () => {
  assert.equal(monthsBetween('2026-08-12', '2026-11-03'), 2);
  assert.equal(monthsBetween('2026-08-02', '2026-11-03'), 3);
  assert.equal(ruleChecks(CHECKS, { issue_date: '2026-09-15' }, ctx)['Not older than 3 months'].ok, true);
  const old = ruleChecks(CHECKS, { issue_date: '2026-06-01' }, ctx)['Not older than 3 months'];
  assert.equal(old.ok, false);
  assert.match(old.message, /5 months old/);
  assert.equal(ruleChecks(CHECKS, {}, ctx)['Not older than 3 months'].ok, null);
});

test('name: "M. Jansen" fails against John Carter; initials and case are fine', () => {
  assert.equal(nameMatches('M. Jansen', 'John Carter'), false);
  assert.equal(nameMatches('J. Carter', 'John Carter'), true);
  assert.equal(nameMatches('MR JOHN CARTER', 'John Carter'), false); // "mr" is not part of the ID name
  assert.equal(nameMatches('John Carter', 'John Carter'), true);
  const r = ruleChecks(CHECKS, { name_on_document: 'M. Jansen' }, ctx)['Name matches your ID'];
  assert.equal(r.ok, false);
  assert.match(r.message, /M\. Jansen/);
});

test('address: postcode and house number must appear', () => {
  assert.equal(addressMatches('263 Upper Street, London N1 9GU', addr), true);
  assert.equal(addressMatches('12 Upper Street, London N1 9GU', addr), false);
  assert.equal(addressMatches('', addr), null);
});

test('combine: rules win where they decided; AI for the rest; AI failure -> pending manual review', () => {
  const ai = { ok: true, checks: [{ name: 'Readable and complete', ok: true, message: '' }, { name: 'Name matches your ID', ok: true, message: '' }] };
  const rules = ruleChecks(CHECKS, { name_on_document: 'M. Jansen', address_on_document: '263 Upper Street N1 9GU', issue_date: '2026-10-01' }, ctx);
  const out = combineChecks(CHECKS, ai, rules);
  assert.deepEqual(out.map((c) => [c.name, c.ok, c.by]), [
    ['Readable and complete', true, 'ai'], ['Name matches your ID', false, 'rule'], ['Address matches what you entered', true, 'rule'], ['Not older than 3 months', true, 'rule'],
  ]);
  assert.deepEqual(failedNames(out), ['Name matches your ID']);
  assert.equal(evidenceStatus(out), 'failed');
  const down = combineChecks(CHECKS, { ok: false, error: 'timeout' }, {});
  assert.ok(down.every((c) => c.ok === null && c.message === 'Pending manual review'));
  assert.equal(evidenceStatus(down), 'pending');
  assert.equal(evidenceStatus(combineChecks(['Readable and complete'], { ok: true, checks: [{ name: 'readable and complete', ok: true }] }, {})), 'passed');
});
