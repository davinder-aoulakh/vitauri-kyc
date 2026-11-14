// Gap G1: who may add bank accounts and upload statements. The UI list and the backend list must be the same.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ACCOUNT_ROLES, WORK_ROLES, INGEST_ROLES } from '../base44/shared/tmAuth.js';
import { PERMISSIONS, hasPermission } from '../src/lib/permissions.js';

const sorted = (a) => [...a].sort();

test('backend ACCOUNT_ROLES equals the UI permission tmManageAccounts', () => {
  assert.deepEqual(sorted(ACCOUNT_ROLES), sorted(PERMISSIONS.tmManageAccounts));
});

test('the six roles of decision D3, and no others', () => {
  assert.deepEqual(sorted(ACCOUNT_ROLES), sorted(['Analyst', 'QC Reviewer', 'Compliance Officer', 'Manager', 'Compliance Admin', 'Tenant Admin']));
  assert.equal(hasPermission('Tenant Admin', 'tmManageAccounts'), true);
  assert.equal(hasPermission('Compliance Admin', 'tmManageAccounts'), true);
  assert.equal(hasPermission('Director', 'tmManageAccounts'), false);
});

test('the existing role lists are unchanged', () => {
  assert.deepEqual(WORK_ROLES, ['Analyst', 'QC Reviewer', 'Compliance Officer', 'Manager']);
  assert.deepEqual(INGEST_ROLES, ['Tenant Admin', 'Compliance Admin']);
  assert.deepEqual(sorted(PERMISSIONS.tmWorkCase), sorted(WORK_ROLES));
  assert.equal(hasPermission('Tenant Admin', 'tmWorkCase'), false);
});

test('the four account / upload functions check ACCOUNT_ROLES', () => {
  for (const fn of ['manageBankAccount', 'manageBankConnection', 'parseStatement', 'commitStatement']) {
    const src = readFileSync(new URL(`../base44/functions/${fn}/entry.ts`, import.meta.url), 'utf8');
    assert.match(src, /roles: ACCOUNT_ROLES, allowApiKey: false/, fn);
    assert.doesNotMatch(src, /\bWORK_ROLES\b/, fn);
  }
});
