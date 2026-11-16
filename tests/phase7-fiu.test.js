// Phase 7: FIU register (gap G24, spec test 9) and the KYC decline path.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  amlV2On, submissionCheck, receiptReference, referenceOf, outcomeFinding, hasOpenEventForCase, kycReportType, wantsKycReport,
} from '../base44/shared/tmFiuSubmission.js';
import { maskTrigger, RESTRICTED_TEXT, AFFECTED_STEPS } from '../base44/shared/cocResponse.js';
import { canAml } from '../base44/shared/workDomain.js';
import { TRIGGER_LABEL } from '../base44/shared/edrTriggers.js';
import { isTmEnabled } from '../base44/shared/tmGuards.js';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const ok = { method: 'portal_upload', evidence_file: 'private/evidence.pdf' };

test('aml_nav_v2 is read as a default-off flag on the server', () => {
  assert.equal(amlV2On({}), false);
  assert.equal(amlV2On({ features_enabled: {} }), false);
  assert.equal(amlV2On({ features_enabled: { aml_nav_v2: true } }), true);
  assert.equal(amlV2On({ features_enabled: JSON.stringify({ aml_nav_v2: true }) }), true);
  // the generic helper would call it on, which is why the FIU rules do not use it for this flag
  assert.equal(isTmEnabled({ features_enabled: {} }, 'aml_nav_v2'), true);
});

test('submission: with the new layout the FIU reference is required', () => {
  assert.match(submissionCheck(ok, { v2: true }).error, /FIU reference is required/);
  assert.match(submissionCheck({ ...ok, fiu_reference: '   ' }, { v2: true }).error, /FIU reference/);
  assert.deepEqual(submissionCheck({ ...ok, fiu_reference: ' FIU-2026-00123 ' }, { v2: true }), { method: 'portal_upload', evidence: 'private/evidence.pdf', reference: 'FIU-2026-00123' });
});

test('submission: with the flag off it works as before', () => {
  assert.deepEqual(submissionCheck(ok, { v2: false }), { method: 'portal_upload', evidence: 'private/evidence.pdf', reference: null });
  assert.match(submissionCheck({ ...ok, method: 'fax' }).error, /method must be/);
  assert.match(submissionCheck({ method: 'm2m' }).error, /Evidence/);
});

test('receipt uses the reference from the submission unless a new one is given', () => {
  const report = { submitted: { fiu_reference: 'FIU-1' } };
  assert.equal(receiptReference(report, {}), 'FIU-1');
  assert.equal(receiptReference(report, { fiu_reference: 'FIU-2' }), 'FIU-2');
  assert.equal(receiptReference({}, {}), '');
  assert.equal(referenceOf({ submitted: { fiu_reference: 'A' } }), 'A');
  assert.equal(referenceOf({ submitted: { fiu_reference: 'A' }, received: { fiu_reference: 'B' } }), 'B');
  assert.equal(referenceOf({}), '');
});

test('receipt creates a restricted change of circumstances without report content', () => {
  const report = { id: 'r1', report_ref: 'UTR-NL-0007', client_id: 'lotte', narrative: { text: 'structuring 11,400' } };
  const tmCase = { id: 'c1', case_ref: 'CASE-2026-0003', alert_ids: ['a1'] };
  const f = outcomeFinding(report, tmCase, 'FIU-2026-00123');
  assert.equal(f.type, 'tm_investigation_outcome');
  assert.equal(f.restricted, true);
  assert.equal(f.source_label, 'Investigation');
  assert.equal(f.key, 'fiu_received:r1');
  assert.equal(f.after.tm_case_id, 'c1');
  assert.ok(!/11,400|structuring/i.test(JSON.stringify(f)));
  assert.ok(TRIGGER_LABEL[f.type] && AFFECTED_STEPS[f.type]);
  // what a KYC-only user sees of it
  const separate = { tm_settings: { role_model: 'separate' } };
  const stored = { id: 't', client_id: 'lotte', status: 'proposed', trigger_type: f.type, restricted: true, after: { ...f.after, summary: f.summary } };
  const masked = maskTrigger(stored, canAml({ app_role: 'Analyst', work_domain: 'kyc' }, separate));
  assert.equal(masked.after.summary, RESTRICTED_TEXT);
  assert.equal(masked.after.fiu_reference, undefined);
  // a report without an investigation (from a KYC review)
  assert.equal(outcomeFinding({ id: 'r2', kyc_case_id: 'k1' }, null, 'X').after.kyc_case_id, 'k1');
});

test('no second event while one for the same investigation awaits a response', () => {
  const open = [{ status: 'proposed', after: { tm_case_id: 'c1' } }, { status: 'accepted', after: { tm_case_id: 'c2' } }, { status: 'proposed', source_ref: 'tm_case:c3' }];
  assert.equal(hasOpenEventForCase(open, 'c1'), true);
  assert.equal(hasOpenEventForCase(open, 'c2'), false);
  assert.equal(hasOpenEventForCase(open, 'c3'), true);
  assert.equal(hasOpenEventForCase(open, 'c9'), false);
  assert.equal(hasOpenEventForCase(open, null), false);
});

test('a report from a KYC review is an activity report, and only on "report to be filed"', () => {
  assert.equal(kycReportType(['UTR', 'SAR', 'STR']), 'SAR');
  assert.equal(kycReportType(['UTR', 'STR']), null);
  assert.equal(kycReportType(undefined), null);
  assert.equal(wantsKycReport('decline', 'report_to_be_filed'), true);
  assert.equal(wantsKycReport('terminate', 'report_to_be_filed'), true);
  assert.equal(wantsKycReport('decline', 'report_filed'), false);
  assert.equal(wantsKycReport('decline', 'no_report_required'), false);
  assert.equal(wantsKycReport('approve', 'report_to_be_filed'), false);
});

test('wiring: schema field, function and sign-off use the rules; the Didit path is untouched', () => {
  const schema = JSON.parse(read('base44/entities/FiuReport.jsonc'));
  assert.equal(schema.properties.submitted.properties.fiu_reference.type, 'string');
  assert.deepEqual(schema.properties.fiu_profile_code.enum, ['CW', 'NL']); // decision D9: BE not added
  const fn = read('base44/functions/recordFiuSubmission/entry.ts');
  assert.ok(fn.includes('submissionCheck(body, { v2 })') && fn.includes('outcomeFinding(') && fn.includes('hasOpenEventForCase('));
  const so = read('base44/functions/caseSignoffAction/entry.ts');
  assert.ok(so.includes('wantsKycReport(action, body.reporting_obligation) && amlV2On(tenant)'));
  assert.ok(read('base44/shared/tmFiuPrepare.js').includes("(origin === 'kyc_case' && caseLess)"));
  assert.ok(read('base44/shared/diditTm.js').includes("'/v3/fiu-reports/'"));
});
