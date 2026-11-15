// Phase 4: escalating alerts into investigations (spec test 8), case outcome (G16), AI proposal followed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  caseGroupingSettings, ruleKeyOf, groupingKeyFor, pickCase, outcomeFor, aiFollowed, autoCaseReason, CASE_OUTCOMES, OUTCOME_LABEL,
} from '../base44/shared/tmCaseGrouping.js';

const A1 = { id: 'a1', client_id: 'c1', scenario_id: 's-struct', rule_ids: ['r1'], source: 'vitauri_rule' };
const A2 = { id: 'a2', client_id: 'c1', scenario_id: 's-rapid', rule_ids: ['r2'], source: 'vitauri_rule' };
const OTHER = { id: 'a3', client_id: 'c2', scenario_id: 's-struct' };

test('settings: one open investigation per customer by default, no auto-create', () => {
  assert.deepEqual(caseGroupingSettings({}), { case_grouping: 'one_open_per_customer', auto_case_objective: false, auto_case_sanctions: false });
  assert.equal(caseGroupingSettings({ tm_settings: { case_grouping: 'per_rule_customer' } }).case_grouping, 'per_rule_customer');
  assert.equal(caseGroupingSettings({ tm_settings: { case_grouping: 'whatever' } }).case_grouping, 'one_open_per_customer');
  assert.equal(caseGroupingSettings({ tm_settings: '{"auto_case_objective":true}' }).auto_case_objective, true);
});

test('spec test 8: two alerts of one customer end in one investigation', () => {
  // First escalation: no open investigation → a new one is started
  assert.equal(pickCase([], A1, 'one_open_per_customer'), null);
  const created = { id: 'case1', status: 'open', primary_client_id: 'c1', created_date: '2026-11-03T10:00:00Z', grouping_key: groupingKeyFor(A1, 'one_open_per_customer') };
  // Second escalation: the open investigation of that customer is found
  assert.equal(pickCase([created], A2, 'one_open_per_customer')?.id, 'case1');
  // Another customer gets its own
  assert.equal(pickCase([created], OTHER, 'one_open_per_customer'), null);
});

test('per rule and customer: a different rule starts a second investigation', () => {
  const c1 = { id: 'case1', status: 'investigating', primary_client_id: 'c1', created_date: '2026-11-03T10:00:00Z', grouping_key: groupingKeyFor(A1, 'per_rule_customer') };
  assert.equal(pickCase([c1], A1, 'per_rule_customer')?.id, 'case1');
  assert.equal(pickCase([c1], A2, 'per_rule_customer'), null);
  assert.equal(groupingKeyFor(A1, 'per_rule_customer'), 'c1:s-struct');
  assert.equal(ruleKeyOf({ rule_ids: ['r9'] }), 'r9');
  assert.equal(ruleKeyOf({ source: 'profile_deviation' }), 'profile_deviation');
});

test('closed, decided and network investigations are never joined; the oldest open one wins', () => {
  const cases = [
    { id: 'closed', status: 'closed', primary_client_id: 'c1', created_date: '2026-01-01' },
    { id: 'decided', status: 'decided_report', primary_client_id: 'c1', created_date: '2026-02-01' },
    { id: 'network', status: 'open', primary_client_id: 'c1', network_origin_case_id: 'x', created_date: '2026-03-01' },
    { id: 'newer', status: 'pending_co', primary_client_id: 'c1', created_date: '2026-06-01' },
    { id: 'older', status: 'open', primary_client_id: 'c1', created_date: '2026-05-01' },
    { id: 'secondary', status: 'open', primary_client_id: 'c9', client_ids: ['c9', 'c1'], created_date: '2026-04-01' },
  ];
  assert.equal(pickCase(cases, A1, 'one_open_per_customer').id, 'older');
  assert.equal(pickCase(cases.slice(0, 3), A1, 'one_open_per_customer'), null);
});

test('outcome on the case: three values (gap G16)', () => {
  assert.deepEqual(CASE_OUTCOMES, ['reported_to_fiu', 'no_report_explained', 'true_positive_no_report']);
  assert.equal(outcomeFor('report'), 'reported_to_fiu');
  assert.equal(outcomeFor('report', 'true_positive_no_report'), 'reported_to_fiu');
  assert.equal(outcomeFor('no_report'), 'no_report_explained');
  assert.equal(outcomeFor('no_report', 'true_positive_no_report'), 'true_positive_no_report');
  assert.equal(outcomeFor('no_report', 'nonsense'), 'no_report_explained');
  assert.ok(CASE_OUTCOMES.every((o) => OUTCOME_LABEL[o]));
});

test('AI proposal followed or not', () => {
  assert.equal(aiFollowed('escalate', 'escalate'), true);
  assert.equal(aiFollowed('close', 'escalate'), false);
  assert.equal(aiFollowed('close', 'close'), true);
  assert.equal(aiFollowed('request_info', 'close'), null);
  assert.equal(aiFollowed(undefined, 'close'), null);
});

test('auto-create only for objective indicators and only when switched on', () => {
  assert.equal(autoCaseReason({ indicator_type: 'objective' }, { auto_case_objective: true }), 'objective indicator');
  assert.equal(autoCaseReason({ indicator_type: 'objective' }, { auto_case_objective: false }), '');
  assert.equal(autoCaseReason({ indicator_type: 'subjective' }, { auto_case_objective: true }), '');
});
