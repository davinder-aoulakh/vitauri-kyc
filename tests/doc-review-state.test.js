import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DOC_CHECK_VERSION, docPending, docFlagged, docDecidable, needsRecheck, catchUpApprovals } from '../src/lib/docReviewState.js';

const doc = (o = {}) => ({ id: 'd1', file_url: 'u1', file_name: 'bill.pdf', review_status: 'Pending_Review', ...o });
const item = (o = {}) => ({ item_id: 'i1', label: 'Additional Documents', file_url: 'u1', status: 'Verified', ...o });
const v2 = (verdict) => ({ verdict, version: '2' });

test('version equals the checker rule version', () => {
  const src = readFileSync(new URL('../base44/shared/docCheckAgent.js', import.meta.url), 'utf8');
  assert.equal(src.match(/CHECK_VERSION = '([^']+)'/)[1], DOC_CHECK_VERSION);
});

test('pending and flagged', () => {
  assert.ok(docPending(doc({ review_status: undefined })));
  assert.ok(!docPending(doc({ review_status: 'Approved' })));
  assert.ok(docFlagged(doc({ ai_check: v2('high_risk') })));
  assert.ok(docFlagged(doc({ ai_check: v2('needs_attention') })));
  assert.ok(!docFlagged(doc({ ai_check: v2('authentic') })));
  assert.ok(!docFlagged(doc({ review_status: 'Approved', ai_check: v2('high_risk') })));
});

test('a verified item with a pending high-risk document can be decided in the case, and is never caught up', () => {
  const d = doc({ ai_check: v2('high_risk') });
  assert.ok(docDecidable(d, item(), false));
  assert.deepEqual(catchUpApprovals([item()], [d]), []);
  assert.deepEqual(catchUpApprovals([item()], [doc({ ai_check: v2('needs_attention') })]), []);
});

test('decidable: received as before; locked, reviewed or other statuses not', () => {
  const d = doc({ ai_check: v2('high_risk') });
  assert.ok(docDecidable(d, item({ status: 'Received' }), false));
  assert.ok(!docDecidable(d, item(), true));
  assert.ok(!docDecidable(d, item({ status: 'Pending' }), false));
  assert.ok(!docDecidable(doc({ review_status: 'Approved' }), item(), false));
  assert.ok(!docDecidable(doc({ review_status: 'Rejected' }), item(), false));
  assert.ok(!docDecidable(null, item(), false));
});

test('catch-up: verified item with a pending clean or unrated document', () => {
  assert.deepEqual(catchUpApprovals([item()], [doc({ ai_check: v2('authentic') })]).map((d) => d.id), ['d1']);
  assert.deepEqual(catchUpApprovals([item()], [doc()]).map((d) => d.id), ['d1']);
});

test('catch-up leaves received items, reviewed documents and locked customers alone', () => {
  const clean = doc({ ai_check: v2('authentic') });
  assert.deepEqual(catchUpApprovals([item({ status: 'Received' })], [clean]), []);
  assert.deepEqual(catchUpApprovals([item()], [doc({ review_status: 'Approved' })]), []);
  assert.deepEqual(catchUpApprovals([item()], [doc({ review_status: 'Rejected' })]), []);
  assert.deepEqual(catchUpApprovals([item()], [clean], { locked: true }), []);
  assert.deepEqual(catchUpApprovals([item({ file_url: '' })], [clean]), []);
  assert.deepEqual(catchUpApprovals([item({ file_url: 'other' })], [clean]), []);
});

test('catch-up: one approval per document; an outdated rating waits for the re-check', () => {
  const clean = doc({ ai_check: v2('authentic') });
  assert.equal(catchUpApprovals([item(), item({ item_id: 'i2' })], [clean]).length, 1);
  const old = doc({ ai_check: { verdict: 'authentic', version: '1' } });
  assert.deepEqual(catchUpApprovals([item()], [old]), []);
  assert.equal(catchUpApprovals([item()], [old], { attempted: ['d1'] }).length, 1);
  const failed = doc({ ai_check: { status: 'error', version: '2' } });
  assert.deepEqual(catchUpApprovals([item()], [failed]), []);
  assert.equal(catchUpApprovals([item()], [failed], { attempted: ['d1'] }).length, 1);
  // still flagged after the re-check was tried: a person decides
  assert.deepEqual(catchUpApprovals([item()], [doc({ ai_check: { verdict: 'high_risk', version: '1' } })], { attempted: ['d1'] }), []);
});

test('needsRecheck: old version or failed check, pending and not reviewed by a person', () => {
  assert.ok(needsRecheck(doc({ ai_check: { verdict: 'high_risk', version: '1' } })));
  assert.ok(needsRecheck(doc({ ai_check: { verdict: 'high_risk' } })));
  assert.ok(needsRecheck(doc({ ai_check: { status: 'error', version: '2' } })));
  assert.ok(!needsRecheck(doc({ ai_check: v2('high_risk') })));
  assert.ok(!needsRecheck(doc()));
  assert.ok(!needsRecheck(doc({ ai_check: { verdict: 'high_risk', version: '1' }, review_status: 'Approved' })));
  assert.ok(!needsRecheck(doc({ ai_check: { verdict: 'high_risk', version: '1' }, reviewed_by_user_id: 'u' })));
  assert.ok(!needsRecheck(doc({ ai_check: { verdict: 'high_risk', version: '1' }, source: 'didit_kyb' })));
});
