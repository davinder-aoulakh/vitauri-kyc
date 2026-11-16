// Phase 6: need-to-know between KYC and AML, and the AML hold (spec section 4, test 10).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { canAml, canKyc, roleModel, domainOf, amlReadRule, ALWAYS_BOTH_ROLES, WORK_DOMAINS } from '../base44/shared/workDomain.js';
import { holdReason, caseHolds, HOLD_CASE_STATUSES, HOLD_REASON } from '../base44/shared/tippingOff.js';
import { maskTrigger, RESTRICTED_TEXT } from '../base44/shared/cocResponse.js';
import { amlNavItems } from '../src/lib/amlNav.js';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const entity = (n) => JSON.parse(read(`base44/entities/${n}.jsonc`));
const separate = { tm_settings: { role_model: 'separate' } };
const combined = { tm_settings: {} };
const u = (app_role, work_domain) => ({ app_role, work_domain });

test('role model: combined unless the tenant chose separate', () => {
  assert.equal(roleModel({}), 'combined');
  assert.equal(roleModel(combined), 'combined');
  assert.equal(roleModel(separate), 'separate');
  assert.equal(roleModel({ tm_settings: JSON.stringify({ role_model: 'separate' }) }), 'separate');
  assert.equal(roleModel({ tm_settings: { role_model: 'other' } }), 'combined');
});

test('combined model: nothing changes, whatever the work domain', () => {
  for (const d of [...WORK_DOMAINS, undefined]) {
    assert.equal(canAml(u('Analyst', d), combined), true);
    assert.equal(canKyc(u('Analyst', d), combined), true);
  }
});

test('separate model: a KYC-only analyst has no AML, an AML-only analyst has no KYC', () => {
  assert.equal(canAml(u('Analyst', 'kyc'), separate), false);
  assert.equal(canKyc(u('Analyst', 'kyc'), separate), true);
  assert.equal(canAml(u('Analyst', 'aml'), separate), true);
  assert.equal(canKyc(u('Analyst', 'aml'), separate), false);
  assert.equal(canAml(u('Manager', 'kyc'), separate), false);
});

test('a missing or unknown work domain counts as both', () => {
  assert.equal(domainOf({}), 'both');
  assert.equal(domainOf({ work_domain: 'x' }), 'both');
  assert.equal(domainOf({ data: { work_domain: 'kyc' } }), 'kyc');
  assert.equal(canAml(u('Analyst'), separate), true);
  assert.equal(canKyc(u('Analyst'), separate), true);
});

test('Compliance and admin roles always see both sides', () => {
  for (const r of ALWAYS_BOTH_ROLES) {
    assert.equal(canAml(u(r, 'kyc'), separate), true, r);
    assert.equal(canKyc(u(r, 'aml'), separate), true, r);
  }
  assert.deepEqual(ALWAYS_BOTH_ROLES, ['Compliance Officer', 'Compliance Admin', 'Tenant Admin', 'Vitauri Ops']);
});

test('sidebar: the AML group, Reporting and AML Dashboard are marked for AML, the KYC group for KYC', () => {
  const g = (name) => amlNavItems.find((x) => x.group === name);
  assert.equal(g('AML').domain, 'aml');
  assert.equal(g('REPORTING').domain, 'aml');
  assert.equal(g('KYC').domain, 'kyc');
  assert.equal(g('CUSTOMERS').domain, undefined);
  const item = (label) => amlNavItems.flatMap((x) => x.items).find((i) => i.label === label);
  assert.equal(item('AML Dashboard').domain, 'aml');
  assert.equal(item('KYC Dashboard').domain, 'kyc');
  assert.equal(item('My Work').domain, undefined);
  assert.ok(read('src/components/layout/AppShell.jsx').includes('domainOk(group.domain)'));
});

test('AML pages refuse a user without AML access', () => {
  for (const f of ['TmAlerts', 'TmCases', 'TmCaseWorkspace', 'FiuReports', 'FiuReportWorkspace', 'TmMi', 'TmQuality', 'TmCoverage']) {
    assert.match(read(`src/pages/${f}.jsx`), /const allowed = .*canAml\(currentUser, tenant\);/, f);
  }
});

test('TM and FIU functions ask for AML access; KYC flows and ingestion do not', () => {
  const fn = (n) => read(`base44/functions/${n}/entry.ts`);
  for (const n of ['tmAlertActions', 'closeTmAlert', 'manageTmCase', 'prepareFiuReport', 'fiuReportAction', 'recordFiuSubmission', 'getFiuArtefactUrl', 'runTmAgent', 'triageAlerts', 'tmDashboardCounts', 'exportTenantTm', 'unlockTippingOff']) {
    assert.ok(fn(n).includes("domain: 'aml'"), n);
  }
  for (const n of ['commitStatement', 'parseStatement', 'manageBankAccount', 'decideEdrTrigger', 'decideScreeningAlert', 'sendOutreachEmail', 'recordKycDecision']) {
    assert.ok(!fn(n).includes("domain: 'aml'"), n);
  }
});

test('restricted change-of-circumstances events are masked for a KYC-only user', () => {
  const t = { id: 't', client_id: 'c', status: 'proposed', trigger_type: 'tm_case', restricted: true, after: { summary: 'TM case decided: report', tm_case_id: 'k' } };
  assert.equal(maskTrigger(t, canAml(u('Analyst', 'kyc'), separate)).after.summary, RESTRICTED_TEXT);
  assert.equal(maskTrigger(t, canAml(u('Analyst', 'aml'), separate)).after.tm_case_id, 'k');
  assert.equal(maskTrigger(t, canAml(u('Compliance Officer', 'kyc'), separate)).after.tm_case_id, 'k');
});

test('AML hold: an open investigation or a report in progress locks the customer', () => {
  assert.deepEqual(HOLD_CASE_STATUSES, ['open', 'investigating', 'pending_co', 'decided_report']);
  for (const s of HOLD_CASE_STATUSES) assert.equal(caseHolds({ status: s }), true, s);
  for (const s of ['decided_no_report', 'closed']) assert.equal(caseHolds({ status: s }), false, s);
  const cases = [
    { status: 'investigating', primary_client_id: 'lotte', client_ids: ['lotte', 'partner'] },
    { status: 'closed', primary_client_id: 'old', client_ids: ['old'] },
  ];
  assert.equal(holdReason([], cases, 'lotte'), 'investigation');
  assert.equal(holdReason([], cases, 'partner'), 'investigation');
  assert.equal(holdReason([], cases, 'old'), null);
  assert.equal(holdReason([], cases, 'someone'), null);
  assert.equal(holdReason([{ locked: true }], [], 'old'), 'fiu');
  assert.equal(holdReason([{ locked: true, unlocked_at: '2026-11-01' }], [], 'old'), null);
  assert.equal(HOLD_REASON, 'AML hold: investigation open');
});

test("the investigation's own customer request is not blocked by its own hold", () => {
  const src = read('base44/shared/tmCaseCommon.js');
  assert.ok(src.includes('assertNoFiuLock(ctx.base44'));
  assert.ok(!src.includes('assertClientNotLocked'));
});

test('User has work_domain with default both', () => {
  const p = entity('User').properties.work_domain;
  assert.deepEqual(p.enum, ['both', 'kyc', 'aml']);
  assert.equal(p.default, 'both');
});

test('read rule: tenant on every branch, AML domains and always-both roles only; applied to the three entities', () => {
  const rule = amlReadRule();
  const branches = rule.$or.filter((b) => b.$and);
  assert.equal(branches.length, 6);
  for (const b of branches) assert.deepEqual(b.$and[0], { 'data.tenant_id': '{{user.data.tenant_id}}' });
  const who = branches.map((b) => JSON.stringify(b.$and[1].user_condition));
  assert.ok(who.includes('{"data.work_domain":"both"}') && who.includes('{"data.work_domain":"aml"}'));
  assert.ok(!who.some((w) => w.includes('"kyc"')));
  assert.deepEqual(rule.$or.at(-1), { user_condition: { role: 'admin' } });
  // applied: the three entities carry exactly this rule; create / update / delete stay tenant-only
  for (const n of ['TmAlert', 'TmCase', 'FiuReport']) {
    assert.deepEqual(entity(n).rls.read, rule, n);
    for (const op of ['create', 'update', 'delete']) assert.deepEqual(entity(n).rls[op], { 'data.tenant_id': '{{user.data.tenant_id}}' }, `${n}.${op}`);
  }
  const doc = read('docs/kyc-aml/phase6-read-rules.md');
  assert.ok(doc.includes(JSON.stringify(rule, null, 2)));
});
