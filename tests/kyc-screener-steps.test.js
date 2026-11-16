import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planAdvance, afterParty, markIncomplete, isStepStale, isRunDead, progressText, MAX_STEP_ATTEMPTS, STEP_STALE_MS, RUN_DEAD_MS } from '../base44/shared/kycScreenerSteps.js';

const T0 = Date.parse('2026-11-18T10:00:00Z');
const iso = (offsetMs) => new Date(T0 + offsetMs).toISOString();
const parties = [{ key: 'client', name: 'Zwarts Management B.V.' }, { key: 'rp_1', name: 'E. Zwarts' }];
const run = (progress, extra = {}) => ({ status: 'running', created_date: iso(0), progress, ...extra });

test('a new run starts with the document step; finished or failed runs do nothing', () => {
  assert.deepEqual(planAdvance(run({ step: 'doc_reader', attempts: 0 }), T0), { action: 'run', step: 'doc_reader', attempt: 1 });
  assert.deepEqual(planAdvance(run(undefined), T0), { action: 'run', step: 'doc_reader', attempt: 1 });
  assert.equal(planAdvance({ status: 'completed' }, T0).action, 'none');
  assert.equal(planAdvance({ status: 'failed' }, T0).action, 'none');
  assert.equal(planAdvance(null, T0).action, 'none');
});

test('a working step is left alone; a step without a heartbeat is retried once', () => {
  const active = run({ step: 'screening', attempts: 1, active: true, started_at: iso(0), parties, party_index: 0 }, { heartbeat_at: iso(40000) });
  assert.equal(planAdvance(active, T0 + 60000).action, 'wait');
  assert.ok(!isStepStale(active, T0 + 60000));
  assert.ok(isStepStale(active, T0 + 40000 + STEP_STALE_MS));
  assert.deepEqual(planAdvance(active, T0 + 40000 + STEP_STALE_MS), { action: 'run', step: 'screening', attempt: 2 });
});

test('screening of a party that died twice is skipped, not failed; other steps fail with a reason', () => {
  const dead = (step) => run({ step, attempts: MAX_STEP_ATTEMPTS, active: true, started_at: iso(0), parties, party_index: 0 }, { heartbeat_at: iso(20000) });
  const s = planAdvance(dead('screening'), T0 + 10 * 60000);
  assert.equal(s.action, 'skip_party');
  assert.match(s.reason, /about 20 s/);
  const r = planAdvance(dead('rules'), T0 + 10 * 60000);
  assert.equal(r.action, 'fail');
  assert.match(r.reason, /Applying the rules grid.*tried 2 times.*Run again/);
  assert.equal(planAdvance(run({ step: 'export', attempts: 2, active: false, last_error: 'boom' }), T0).action, 'fail');
});

test('one screening call per party, then rules', () => {
  let p = { step: 'screening', party_index: 0, parties, screening_raw: [], attempts: 2, active: true };
  p = afterParty(p, { checks: { sanctions: { result: 'no_match' } } });
  assert.equal(p.step, 'screening');
  assert.equal(p.party_index, 1);
  assert.equal(p.attempts, 0);
  assert.equal(p.active, false);
  p = afterParty(p, { failed: true, error: 'timed out' });
  assert.equal(p.step, 'rules');
  assert.deepEqual(p.screening_raw.map((x) => x.party_key), ['client', 'rp_1']);
  // a retry of the same party replaces its entry
  const again = afterParty({ ...p, party_index: 1, step: 'screening' }, { checks: {} });
  assert.equal(again.screening_raw.length, 2);
  assert.ok(!again.screening_raw[1].failed);
});

test('a party that could not be screened is inconclusive and says so, never "no match"', () => {
  const check = { result: 'inconclusive', matches: [], missing: true };
  const screening = { parties: [
    { party_key: 'client', name: 'A', checks: { sanctions: { result: 'no_match', matches: [] }, pep: { result: 'no_match', matches: [] }, adverse_media: { result: 'no_match', matches: [] } } },
    { party_key: 'rp_1', name: 'B', checks: { sanctions: check, pep: check, adverse_media: check } },
  ] };
  const out = markIncomplete(screening, [{ party_key: 'client' }, { party_key: 'rp_1', failed: true, error: 'timed out' }]);
  assert.equal(out.parties[0].checks.sanctions.result, 'no_match');
  assert.ok(!out.parties[0].incomplete);
  assert.ok(out.parties[1].incomplete);
  for (const k of ['sanctions', 'pep', 'adverse_media']) {
    assert.equal(out.parties[1].checks[k].result, 'inconclusive');
    assert.match(out.parties[1].checks[k].note, /could not be completed \(timed out\)/);
  }
  assert.equal(markIncomplete(screening, []), screening);
});

test('the two real stuck runs count as dead; a fresh run does not', () => {
  const stuck = { status: 'running', stage: 'screening', created_date: '2026-11-12T00:32:15.510000', updated_date: '2026-11-12T00:32:42.824000', ran_at: '2026-11-12T00:32:15.430Z' };
  assert.ok(isRunDead(stuck, T0));
  assert.ok(!isRunDead(run({ step: 'screening' }, { heartbeat_at: iso(0) }), T0 + RUN_DEAD_MS - 1000));
  assert.ok(isRunDead(run({ step: 'screening' }, { heartbeat_at: iso(0) }), T0 + RUN_DEAD_MS));
  assert.ok(!isRunDead({ status: 'completed', created_date: iso(-RUN_DEAD_MS * 5) }, T0));
});

test('progress text', () => {
  assert.equal(progressText(run({ step: 'doc_reader' })), 'Reading documents');
  assert.equal(progressText(run({ step: 'screening', party_index: 1, parties })), 'Screening 2 of 2: E. Zwarts');
  assert.equal(progressText(run({ step: 'export' })), 'Building Excel and PDF');
  assert.equal(progressText({ status: 'running', stage: 'rules' }), 'Applying the rules grid');
});
