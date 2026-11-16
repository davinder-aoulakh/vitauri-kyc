import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { QC_OVERRULE_ROLES, QC_NOT_OVERRULABLE, QC_OVERRULE_MIN, canOverruleFinding, overruleBlock, validateOverrule, qcOutcome } from '../base44/shared/qcRules.js';

const f = (o = {}) => ({ id: 'f1', code: 'R7', check: 'report', kind: 'auto', severity: 'major', status: 'open', step: 10, ...o });

test('who may overrule: QC and senior roles, not the Analyst', () => {
  assert.deepEqual([...QC_OVERRULE_ROLES].sort(), ['Compliance Admin', 'Compliance Officer', 'Director', 'Manager', 'QC Reviewer', 'Tenant Admin']);
  assert.ok(!QC_OVERRULE_ROLES.includes('Analyst'));
});

test('findings of the QC Agent can be overruled, whatever the severity', () => {
  for (const severity of ['blocker', 'major', 'minor']) assert.ok(canOverruleFinding(f({ severity })));
  assert.ok(canOverruleFinding(f({ code: 'C5', check: 'case', step: 5 })));
  assert.ok(canOverruleFinding(f({ code: 'C6', check: 'case', step: 7, severity: 'blocker' })));
  assert.ok(canOverruleFinding(f({ status: 'returned' })));
});

test('hard facts, human decisions and settled findings cannot be overruled', () => {
  assert.deepEqual(QC_NOT_OVERRULABLE, ['C2', 'C3', 'C8']);
  for (const code of QC_NOT_OVERRULABLE) assert.match(overruleBlock(f({ code, check: 'case', step: 2 })), /cannot be overruled/);
  assert.ok(!canOverruleFinding(f({ code: 'C10', kind: 'human', status: 'needs_human' })));
  assert.ok(!canOverruleFinding(f({ code: 'C10-NP', severity: 'blocker' })));
  for (const status of ['resolved', 'dismissed', 'carried', 'overruled', 'needs_human']) assert.ok(!canOverruleFinding(f({ status })));
  assert.ok(!canOverruleFinding(null));
});

test('rationale is mandatory, at least 30 characters', () => {
  assert.equal(QC_OVERRULE_MIN, 30);
  assert.ok(validateOverrule(''));
  assert.ok(validateOverrule(undefined));
  assert.ok(validateOverrule('x'.repeat(29)));
  assert.ok(validateOverrule(`${' '.repeat(40)}short`));
  assert.equal(validateOverrule('x'.repeat(30)), null);
});

test('an overruled finding no longer blocks the round; open ones still do', () => {
  assert.equal(qcOutcome([f()]), 'failed');
  assert.equal(qcOutcome([f({ status: 'overruled' })]), 'passed');
  assert.equal(qcOutcome([f({ status: 'overruled' }), f({ id: 'f2', code: 'C8', severity: 'blocker' })]), 'failed');
  assert.equal(qcOutcome([f({ status: 'overruled' }), f({ id: 'f3', code: 'C10', kind: 'human', status: 'needs_human' })]), 'paused');
  assert.equal(qcOutcome([f({ status: 'overruled' }), f({ id: 'f4', severity: 'minor' })]), 'passed');
});

test('schema and engine know the status; an overrule blocks automatic approval', () => {
  const schema = readFileSync(new URL('../base44/entities/QcFinding.jsonc', import.meta.url), 'utf8');
  assert.match(schema, /"overruled"/);
  for (const v of ['open', 'returned', 'needs_human', 'resolved', 'dismissed', 'carried']) assert.match(schema, new RegExp(`"${v}"`));
  const fn = readFileSync(new URL('../base44/functions/runCaseQc/entry.ts', import.meta.url), 'utf8');
  assert.match(fn, /qc\.finding_overruled/);
  assert.match(fn, /is_override: true/);
  const so = readFileSync(new URL('../base44/functions/caseSignoffAction/entry.ts', import.meta.url), 'utf8');
  assert.match(so, /f\.status === 'overruled'/);
});
