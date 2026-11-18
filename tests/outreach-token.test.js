import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newToken, looksLikeToken, hashToken, linkDates, linkState, createAttemptLimiter } from '../base44/shared/outreachToken.js';

test('a token is 32 random bytes as base64url (43 characters), unique', () => {
  const a = newToken();
  const b = newToken();
  assert.equal(a.length, 43);
  assert.ok(looksLikeToken(a));
  assert.notEqual(a, b);
  assert.ok(!/[+/=]/.test(a));
});

test('looksLikeToken refuses junk before any lookup', () => {
  for (const t of ['', 'abc', null, undefined, 42, 'x'.repeat(44), `${'a'.repeat(42)}+`, `${'a'.repeat(42)}/`]) assert.equal(looksLikeToken(t), false, String(t));
  assert.equal(looksLikeToken('a'.repeat(43)), true);
});

test('the hash is SHA-256 hex and stable; the token itself is not in it', async () => {
  const t = newToken();
  const h = await hashToken(t);
  assert.match(h, /^[0-9a-f]{64}$/);
  assert.equal(h, await hashToken(t));
  assert.notEqual(h, await hashToken(newToken()));
  assert.ok(!h.includes(t));
  assert.equal(await hashToken('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
});

test('deadline and expiry: deadline plus grace days', () => {
  const d = linkDates('2026-11-18T10:00:00.000Z', 14, 7);
  assert.equal(d.deadline, '2026-12-02T10:00:00.000Z');
  assert.equal(d.token_expires_at, '2026-12-09T10:00:00.000Z');
  assert.equal(linkDates('2026-11-18T10:00:00.000Z', 0, 0).deadline, '2026-12-02T10:00:00.000Z'); // no or invalid days: 14
  assert.equal(linkDates('2026-11-18T10:00:00.000Z', 1, 0).token_expires_at, '2026-11-19T10:00:00.000Z');
});

test('link state: valid, expired after grace, submitted stays open, cancelled', () => {
  const now = Date.parse('2026-12-05T00:00:00Z');
  const conv = { status: 'Opened', token_expires_at: '2026-12-09T10:00:00.000Z' };
  assert.equal(linkState({}, conv, now), 'valid');
  assert.equal(linkState({}, conv, Date.parse('2026-12-10T00:00:00Z')), 'expired');
  assert.equal(linkState({}, { ...conv, status: 'Expired' }, now), 'expired');
  assert.equal(linkState({}, { ...conv, status: 'Submitted' }, Date.parse('2027-02-01T00:00:00Z')), 'submitted');
  assert.equal(linkState({}, { ...conv, status: 'Cancelled' }, now), 'cancelled');
  assert.equal(linkState({ token_expires_at: '2026-12-01T00:00:00Z' }, { status: 'Sent' }, now), 'expired'); // falls back to the carrier
});

test('the limiter blocks after the maximum of failures per key, within the window only', () => {
  let t = 0;
  const l = createAttemptLimiter({ max: 3, windowMs: 1000, now: () => t });
  assert.equal(l.blocked('ip:1'), false);
  l.fail('ip:1'); l.fail('ip:1');
  assert.equal(l.blocked('ip:1'), false);
  l.fail('ip:1');
  assert.equal(l.blocked('ip:1'), true);
  assert.equal(l.blocked('ip:2'), false);
  t = 1001;
  assert.equal(l.blocked('ip:1'), false);
  assert.equal(l.blocked(''), false);
});
