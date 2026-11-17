import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planAdvance, afterCheck, afterRuleBatch, mergeRuleOutcomes, markIncomplete, isStepStale, isRunDead, progressText, MAX_STEP_ATTEMPTS, STEP_STALE_MS, RUN_DEAD_MS, RULE_BATCH_SIZE, SCREEN_CHECKS } from '../base44/shared/kycScreenerSteps.js';

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

test('a screening check that died twice is skipped, not failed; other steps fail with a reason', () => {
  const dead = (step) => run({ step, attempts: MAX_STEP_ATTEMPTS, active: true, started_at: iso(0), parties, party_index: 0 }, { heartbeat_at: iso(20000) });
  const s = planAdvance(dead('screening'), T0 + 10 * 60000);
  assert.equal(s.action, 'skip_check');
  assert.match(s.reason, /about 20 s/);
  const r = planAdvance(dead('rules'), T0 + 10 * 60000);
  assert.equal(r.action, 'fail');
  assert.match(r.reason, /Applying the rules grid.*tried 2 times.*Run again/);
  assert.equal(planAdvance(run({ step: 'export', attempts: 2, active: false, last_error: 'boom' }), T0).action, 'fail');
});

test('screening runs one call per check of each party, then the rules', () => {
  let p = { step: 'screening', party_index: 0, check_index: 0, parties, screening_raw: [], attempts: 2, active: true };
  p = afterCheck(p, 'sanctions', { result: 'no_match', matches: [] });
  assert.equal(p.step, 'screening');
  assert.equal(p.party_index, 0);
  assert.equal(p.check_index, 1);
  assert.equal(p.attempts, 0);
  assert.equal(p.active, false);
  // a check that could not be completed is inconclusive for that check only; the party's other checks still run
  p = afterCheck(p, 'pep', { failed: true, error: 'Claude did not answer within 20 seconds.' });
  assert.equal(p.screening_raw[0].checks.pep.result, 'inconclusive');
  assert.equal(p.screening_raw[0].checks.pep.incomplete, true);
  assert.match(p.screening_raw[0].checks.pep.note, /timed out|20 seconds/);
  p = afterCheck(p, 'adverse_media', { result: 'hit', matches: [{ name_matched: 'X' }] });
  // party finished: the next party starts at its first check
  assert.equal(p.party_index, 1);
  assert.equal(p.check_index, 0);
  assert.equal(p.step, 'screening');
  assert.deepEqual(p.screening_raw.map((x) => x.party_key), ['client']);
  for (const c of SCREEN_CHECKS) p = afterCheck(p, c, { result: 'no_match', matches: [] });
  assert.equal(p.step, 'rules');
  assert.deepEqual(Object.keys(p.screening_raw[1].checks), SCREEN_CHECKS);
});

test('a large grid is applied in parts, then the verdict', () => {
  const grid = Array.from({ length: 21 }, (_, i) => ({ id: `R${i + 1}`, text: `rule ${i + 1}` }));
  const part = grid.slice(0, RULE_BATCH_SIZE).map((r) => ({ rule_id: r.id, outcome: 'pass', evidence: 'ok' }));
  let p = { step: 'rules', rule_index: 0, rule_outcomes: [], attempts: 2, active: true };
  p = afterRuleBatch(p, part, grid.length);
  assert.equal(p.step, 'rules');
  assert.equal(p.rule_index, RULE_BATCH_SIZE);
  assert.equal(p.rule_total, 21);
  assert.equal(p.attempts, 0);
  assert.equal(p.active, false);
  // the same part retried replaces its outcomes instead of doubling them
  const again = afterRuleBatch({ ...p, rule_index: 0 }, [{ rule_id: 'R1', outcome: 'fail', evidence: 'x' }], grid.length);
  assert.equal(again.rule_outcomes.filter((o) => o.rule_id === 'R1').length, 1);
  assert.equal(again.rule_index, RULE_BATCH_SIZE);
  // the last part hands over to the verdict
  const last = afterRuleBatch({ ...p, rule_index: 16 }, grid.slice(16).map((r) => ({ rule_id: r.id, outcome: 'n/a', evidence: '' })), grid.length);
  assert.equal(last.step, 'verdict');
  assert.equal(last.rule_index, 21);
});

test('every rule of the grid gets an outcome, in grid order; a rule left out reads n/a', () => {
  const grid = [{ id: 'R1', text: 'one' }, { id: 'R2', text: 'two' }, { id: 'R3', text: 'three' }];
  const out = mergeRuleOutcomes(grid, [{ rule_id: 'R3', outcome: 'fail', evidence: 'hit' }, { rule_id: 'R1', outcome: 'pass', evidence: 'ok' }]);
  assert.deepEqual(out.map((o) => o.rule_id), ['R1', 'R2', 'R3']);
  assert.equal(out[1].outcome, 'n/a');
  assert.match(out[1].evidence, /Not answered/);
  assert.equal(out[2].rule_text, 'three');
  assert.equal(mergeRuleOutcomes([], []).length, 0);
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
  assert.equal(progressText(run({ step: 'screening', party_index: 1, check_index: 2, parties })), 'Screening 2 of 2: E. Zwarts (adverse media)');
  assert.equal(progressText(run({ step: 'screening', party_index: 0, check_index: 1, parties })), 'Screening 1 of 2: Zwarts Management B.V. (PEP)');
  assert.equal(progressText(run({ step: 'export' })), 'Building Excel and PDF');
  assert.equal(progressText({ status: 'running', stage: 'rules' }), 'Applying the rules grid');
  assert.equal(progressText(run({ step: 'rules', rule_index: 8, rule_total: 21 })), 'Applying the rules grid (part 2 of 3)');
  assert.equal(progressText(run({ step: 'rules', rule_index: 0, rule_total: 5 })), 'Applying the rules grid');
  assert.equal(progressText(run({ step: 'verdict' })), 'Reaching the risk verdict');
});