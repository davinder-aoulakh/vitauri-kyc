import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluateCondition as ev, validateCondition, describeCondition, conditionBlocks, CONDITION_OPERATORS } from '../base44/shared/outreachConditions.js';

const ctx = {
  answers: { sof: ['Salary', 'Inheritance or gift'], pep: 'Yes', employment: 'Self-employed', empty: [] },
  risk: 'high', route: 'nl', legal_form_kind: 'partnership',
  failed_checks: ['Name matches your ID'], calculations: { 'no owner reaches threshold': true },
};

test('empty condition is always true', () => {
  for (const c of [undefined, null, {}, true]) assert.equal(ev(c, ctx), true);
});

test('answer_includes: list or text, case-insensitive; unknown block is false', () => {
  assert.equal(ev({ answer_includes: { block: 'sof', value: 'Salary' } }, ctx), true);
  assert.equal(ev({ answer_includes: { block: 'sof', value: 'inheritance or gift' } }, ctx), true);
  assert.equal(ev({ answer_includes: { block: 'sof', value: 'Savings' } }, ctx), false);
  assert.equal(ev({ answer_includes: { block: 'pep', value: 'Yes' } }, ctx), true);
  assert.equal(ev({ answer_includes: { block: 'nope', value: 'Salary' } }, ctx), false);
  assert.equal(ev({ answer_includes: { block: 'empty', value: 'x' } }, ctx), false);
});

test('answer_equals: exactly one value', () => {
  assert.equal(ev({ answer_equals: { block: 'pep', value: 'Yes' } }, ctx), true);
  assert.equal(ev({ answer_equals: { block: 'pep', value: 'No' } }, ctx), false);
  assert.equal(ev({ answer_equals: { block: 'sof', value: 'Salary' } }, ctx), false); // two answers
  assert.equal(ev({ answer_equals: { block: 'nope', value: 'Yes' } }, ctx), false);
});

test('risk_in, legal_form_kind, route, document_check_failed, calculated', () => {
  assert.equal(ev({ risk_in: ['medium', 'high'] }, ctx), true);
  assert.equal(ev({ risk_in: ['low'] }, ctx), false);
  assert.equal(ev({ risk_in: ['high'] }, { ...ctx, risk: undefined }), false);
  assert.equal(ev({ legal_form_kind: 'partnership' }, ctx), true);
  assert.equal(ev({ legal_form_kind: 'sole' }, ctx), false);
  assert.equal(ev({ legal_form_kind: 'sole' }, {}), false);
  assert.equal(ev({ route: 'nl' }, ctx), true);
  assert.equal(ev({ route: 'document' }, ctx), false);
  assert.equal(ev({ document_check_failed: 'Name matches your ID' }, ctx), true);
  assert.equal(ev({ document_check_failed: 'Not older than 3 months' }, ctx), false);
  assert.equal(ev({ calculated: 'no owner reaches threshold' }, ctx), true);
  assert.equal(ev({ calculated: 'something else' }, ctx), false);
});

test('all, any, not and nesting', () => {
  const payslip = { all: [{ risk_in: ['high'] }, { answer_includes: { block: 'sof', value: 'Salary' } }] };
  assert.equal(ev(payslip, ctx), true);
  assert.equal(ev(payslip, { ...ctx, risk: 'low' }), false);
  assert.equal(ev({ any: [{ route: 'document' }, { answer_equals: { block: 'pep', value: 'Yes' } }] }, ctx), true);
  assert.equal(ev({ any: [{ route: 'document' }, { risk_in: ['low'] }] }, ctx), false);
  assert.equal(ev({ not: { legal_form_kind: 'sole' } }, ctx), true);
  assert.equal(ev({ not: { legal_form_kind: 'partnership' } }, ctx), false);
  const deep = { all: [{ not: { any: [{ route: 'document' }, { risk_in: ['low'] }] } }, { any: [{ answer_includes: { block: 'sof', value: 'Savings' } }, { calculated: 'no owner reaches threshold' }] }] };
  assert.equal(ev(deep, ctx), true);
  assert.equal(ev({ all: [] }, ctx), true);
  assert.equal(ev({ any: [] }, ctx), false);
});

test('unknown operator is false and invalid', () => {
  assert.equal(ev({ answer_contains: { block: 'sof', value: 'Salary' } }, ctx), false);
  assert.match(validateCondition({ answer_contains: {} }).join(), /unknown operator/);
});

test('validateCondition reports problems, including an unknown block', () => {
  assert.deepEqual(validateCondition({ answer_includes: { block: 'sof', value: 'Salary' } }, ['sof']), []);
  assert.match(validateCondition({ answer_includes: { block: 'sofx', value: 'Salary' } }, ['sof']).join(), /unknown block "sofx"/);
  assert.match(validateCondition({ risk_in: ['extreme'] }).join(), /low, medium, high/);
  assert.match(validateCondition({ route: 'kvk' }).join(), /nl or document/);
  assert.match(validateCondition({ legal_form_kind: 'trust' }).join(), /company, partnership or sole/);
  assert.match(validateCondition({ all: [] }).join(), /list of conditions/);
  assert.match(validateCondition({ not: [] }).join(), /one condition/);
  assert.match(validateCondition({ all: [{ answer_equals: { block: 'pep' } }] }).join(), /needs a value/);
  assert.deepEqual(validateCondition(null), []);
  assert.equal(CONDITION_OPERATORS.length, 10);
});

test('describeCondition and conditionBlocks', () => {
  assert.equal(describeCondition(null), 'Always');
  assert.equal(describeCondition({ all: [{ risk_in: ['high'] }, { answer_includes: { block: 'sof', value: 'Salary' } }] }), 'risk is high and "sof" includes "Salary"');
  assert.equal(describeCondition({ not: { legal_form_kind: 'sole' } }), 'not (legal form is sole)');
  assert.equal(describeCondition({ any: [{ route: 'nl' }, { all: [{ risk_in: ['low'] }, { calculated: 'x' }] }] }), 'route is nl or (risk is low and calculation: x)');
  assert.deepEqual([...conditionBlocks({ any: [{ answer_includes: { block: 'sof', value: 'a' } }, { not: { answer_equals: { block: 'pep', value: 'b' } } }] })].sort(), ['pep', 'sof']);
});
