// Phase 5: screening decides, change of circumstances acts (spec test 11).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  RESPONSES, STATUS_LABEL, stepsForResponse, deltaSkipped, isScreeningAlert, isSanctionsAlert, hitSourceFor,
  maskTrigger, RESTRICTED_TEXT, AFFECTED_STEPS,
} from '../base44/shared/cocResponse.js';
import { getStepStatus, isStepComplete } from '../src/lib/caseUtils.js';
import { stepDone } from '../base44/shared/qcRules.js';
import { TRIGGER_LABEL } from '../base44/shared/edrTriggers.js';
import { autoCaseReason } from '../base44/shared/tmCaseGrouping.js';
import { amlNavItems } from '../src/lib/amlNav.js';

const entity = (n) => JSON.parse(readFileSync(new URL(`../base44/entities/${n}.jsonc`, import.meta.url), 'utf8'));
const skipped = (r) => Object.entries(r.flags).filter(([, v]) => v).map(([k]) => Number(k.match(/\d+/)[0]));

test('screening hit + targeted check re-runs only Screening and Risk assessment', () => {
  const r = stepsForResponse('screening_hit', 'targeted_check');
  assert.equal(r.createsReview, true);
  assert.deepEqual(r.required, [3, 6]);
  assert.deepEqual(skipped(r), [1, 2, 4, 5, 7]);
});

test('screening hit + risk reassessment also re-runs Control measures (spec test 11)', () => {
  const r = stepsForResponse('screening_hit', 'risk_reassessment');
  assert.deepEqual(r.required, [3, 6, 7]);
  assert.deepEqual(skipped(r), [1, 2, 4, 5]);
});

test('profile breach touches Client profile, SoF and Risk assessment', () => {
  assert.deepEqual(stepsForResponse('profile_breach', 'targeted_check').required, [4, 5, 6]);
});

test('full refresh skips nothing; no action opens no review; unknown type means every step', () => {
  assert.deepEqual(skipped(stepsForResponse('screening_hit', 'full_cdd_refresh')), []);
  assert.deepEqual(stepsForResponse('screening_hit', 'no_action'), { createsReview: false, required: [], flags: {} });
  assert.deepEqual(stepsForResponse('something_new', 'targeted_check').required, [1, 2, 3, 4, 5, 6, 7]);
  assert.throws(() => stepsForResponse('screening_hit', 'maybe'));
});

test('every trigger type on the entity has a label and an affected-steps row', () => {
  const types = entity('EdrTrigger').properties.trigger_type.enum;
  for (const t of ['id_expiry', 'address_change', 'tm_alert_frequency', 'tm_new_country', 'tm_investigation_outcome']) assert.ok(types.includes(t), t);
  for (const t of types) { assert.ok(TRIGGER_LABEL[t], `label for ${t}`); assert.ok(AFFECTED_STEPS[t], `steps for ${t}`); }
  assert.deepEqual(entity('EdrTrigger').properties.response.enum, RESPONSES);
});

test('status labels', () => {
  assert.deepEqual(STATUS_LABEL, { proposed: 'Awaiting response', accepted: 'Review started', dismissed: 'Closed' });
});

test('a skipped step counts as done only in a review opened by a response', () => {
  const delta = { delta_response: 'targeted_check', step_1_not_required: true, step_3_status: 'not_started', step_5_not_required: true };
  assert.equal(getStepStatus(delta, 1), 'not_required');
  assert.equal(isStepComplete(delta, 1), true);
  assert.equal(getStepStatus(delta, 3), 'not_started');
  assert.equal(getStepStatus(delta, 5), 'not_required');
  assert.equal(stepDone(delta, 1), true);
  assert.equal(stepDone(delta, 3), false);
  // an ordinary case: the flag on steps 1-4 and 6 is ignored, 5 / 7 / 11 behave as before
  const plain = { step_1_not_required: true, step_2_not_required: true, step_5_not_required: true, step_11_not_required: true };
  assert.equal(getStepStatus(plain, 1), 'not_started');
  assert.equal(getStepStatus(plain, 2), 'not_started');
  assert.equal(getStepStatus(plain, 5), 'not_required');
  assert.equal(getStepStatus(plain, 11), 'not_required');
  assert.equal(deltaSkipped(plain, 1), false);
  assert.equal(stepDone(plain, 1), false);
  assert.equal(stepDone(plain, 2), true); // unchanged: QC already accepted step 2 as not required
});

test('KycCase has the new step flags', () => {
  const p = entity('KycCase').properties;
  for (const n of [1, 3, 4, 6]) assert.equal(p[`step_${n}_not_required`]?.type, 'boolean');
  assert.equal(p.delta_response?.type, 'string');
});

test('screening alerts and other signals', () => {
  for (const t of ['Screening_Hit', 'Manual_Flag', 'Didit_Ongoing_PEP', 'Didit_Ongoing_Sanctions', 'Didit_Ongoing_Adverse_Media', 'Didit_Ongoing_High_Risk']) assert.equal(isScreeningAlert({ alert_type: t }), true, t);
  for (const t of ['Register_Change', 'Didit_Abandoned', 'Transaction_Rule_Hit']) assert.equal(isScreeningAlert({ alert_type: t }), false, t);
  assert.equal(isSanctionsAlert({ alert_type: 'Didit_Ongoing_Sanctions' }), true);
  assert.equal(isSanctionsAlert({ alert_type: 'Screening_Hit', source: 'Sanctions_UN' }), true);
  assert.equal(isSanctionsAlert({ alert_type: 'Didit_Ongoing_PEP' }), false);
  assert.equal(hitSourceFor({ alert_type: 'Screening_Hit', source: 'Sanctions_UN' }), 'Sanctions_UN');
  assert.equal(hitSourceFor({ alert_type: 'Didit_Ongoing_PEP', source: 'Didit_Ongoing_Monitoring' }), 'PEP_List');
  assert.equal(hitSourceFor({ alert_type: 'Manual_Flag', source: 'Manual flag by X' }), 'Internal_Flag');
  assert.ok(entity('MonitoringAlert').properties.status.enum.includes('Confirmed_Match'));
});

test('a restricted event is masked for users without AML access', () => {
  const t = { id: 't1', client_id: 'c1', status: 'proposed', trigger_type: 'tm_case', restricted: true, source_label: 'Investigation', before: { x: 1 }, after: { summary: 'TM case X decided: report to FIU', tm_case_id: 'k' }, source_ref: 'tm_case:k' };
  const m = maskTrigger(t, false);
  assert.equal(m.masked, true);
  assert.equal(m.after.summary, RESTRICTED_TEXT);
  assert.deepEqual(m.before, {});
  assert.equal(m.source_ref, undefined);
  assert.equal(m.after.tm_case_id, undefined);
  assert.equal(maskTrigger(t, true).after.tm_case_id, 'k');
  assert.equal(maskTrigger({ ...t, restricted: false }, false).after.tm_case_id, 'k');
});

test('confirmed sanctions hit starts an investigation only when the tenant switch is on', () => {
  assert.equal(autoCaseReason({ sanctions_confirmed: true }, { auto_case_sanctions: true }), 'confirmed sanctions hit');
  assert.equal(autoCaseReason({ sanctions_confirmed: true }, { auto_case_sanctions: false }), '');
  assert.equal(autoCaseReason({ indicator_type: 'objective' }, { auto_case_objective: true }), 'objective indicator');
});

test('Change of circumstances is in the KYC group and has a route', () => {
  const kyc = amlNavItems.find((g) => g.group === 'KYC').items;
  assert.ok(kyc.some((i) => i.label === 'Change of circumstances' && i.href === '/kyc/changes'));
  assert.ok(readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8').includes('path="/kyc/changes"'));
});
