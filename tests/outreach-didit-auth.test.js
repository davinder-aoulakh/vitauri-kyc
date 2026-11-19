// Phase 4: the conversation token branch of authorizeOutreachCaller (base44/shared/diditSessionAuth.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { authorizeOutreachCaller } from '../base44/shared/diditSessionAuth.js';
import { hashToken } from '../base44/shared/outreachToken.js';

const fake = (row, user = null) => ({
  asServiceRole: { entities: { OutreachRequest: { filter: async ({ id }) => (id === row.id ? [row] : []) } } },
  auth: { me: async () => user },
});
const TOKEN = 'a'.repeat(43);

test('a conversation link token is accepted through its SHA-256', async () => {
  const row = { id: 'r1', tenant_id: 't1', engine: 'conversation', token_hash: await hashToken(TOKEN), status: 'In_Progress', token_expires_at: '2999-01-01T00:00:00Z' };
  const a = await authorizeOutreachCaller(fake(row), { outreach_id: 'r1', access_token: TOKEN });
  assert.equal(a.mode, 'portal');
  assert.equal(a.outreach.id, 'r1');
});

test('wrong token, expired link and a closed request are refused', async () => {
  const row = { id: 'r1', tenant_id: 't1', engine: 'conversation', token_hash: await hashToken(TOKEN), status: 'In_Progress', token_expires_at: '2999-01-01T00:00:00Z' };
  assert.equal((await authorizeOutreachCaller(fake(row), { outreach_id: 'r1', access_token: 'b'.repeat(43) })).error.status, 403);
  assert.equal((await authorizeOutreachCaller(fake({ ...row, token_expires_at: '2000-01-01T00:00:00Z' }), { outreach_id: 'r1', access_token: TOKEN })).error.status, 403);
  assert.equal((await authorizeOutreachCaller(fake({ ...row, status: 'Complete' }), { outreach_id: 'r1', access_token: TOKEN })).error.status, 403);
  assert.equal((await authorizeOutreachCaller(fake({ ...row, token_hash: null }), { outreach_id: 'r1', access_token: TOKEN })).error.status, 403);
});

test('classic access_token unchanged; a conversation request cannot be opened with the classic token check', async () => {
  const classic = { id: 'c1', tenant_id: 't1', access_token: 'classic-token' };
  assert.equal((await authorizeOutreachCaller(fake(classic), { outreach_id: 'c1', access_token: 'classic-token' })).mode, 'portal');
  assert.equal((await authorizeOutreachCaller(fake(classic), { outreach_id: 'c1', access_token: 'other' })).error.status, 403);
  const conv = { id: 'r2', tenant_id: 't1', engine: 'conversation', token_hash: await hashToken(TOKEN), access_token: '' };
  assert.equal((await authorizeOutreachCaller(fake(conv), { outreach_id: 'r2', access_token: '' })).error.status, 401); // no token: staff path, no user
});
