// The frontend does not import from base44/shared; rules used on both sides have a copy in src/lib.
// This test keeps the copies in step: everything a frontend copy exports must be identical to the backend original.
import { test } from 'node:test';
import assert from 'node:assert/strict';

const same = (a, b) => (typeof a === 'function' ? a.toString() === b.toString() : JSON.stringify(a) === JSON.stringify(b));

async function compare(frontend, backends) {
  const f = await import(`../src/lib/${frontend}`);
  const b = Object.assign({}, ...(await Promise.all(backends.map((x) => import(`../base44/shared/${x}`)))));
  const names = Object.keys(f);
  assert.ok(names.length > 0, `${frontend} exports nothing`);
  for (const n of names) {
    assert.ok(n in b, `${frontend}: ${n} has no backend original in ${backends.join(', ')}`);
    assert.ok(same(f[n], b[n]), `${frontend}: ${n} differs from the backend original`);
  }
  return names.length;
}

test('cocResponse copy matches base44/shared', async () => { assert.ok(await compare('cocResponse.js', ['cocResponse.js']) >= 10); });
test('workDomain copy matches base44/shared', async () => { assert.ok(await compare('workDomain.js', ['workDomain.js']) >= 6); });
test('tmFiuSubmission copy matches base44/shared', async () => { assert.ok(await compare('tmFiuSubmission.js', ['tmFiuSubmission.js']) >= 3); });
test('tmLibraryScope copy matches base44/shared', async () => { assert.ok(await compare('tmLibraryScope.js', ['tmLibraryScope.js']) >= 3); });
test('tenant settings readers match tmDetection and tmCaseGrouping', async () => {
  const f = await import('../src/lib/tmTenantSettings.js');
  const d = await import('../base44/shared/tmDetection.js');
  const g = await import('../base44/shared/tmCaseGrouping.js');
  const tenants = [{}, { tm_settings: {} }, { tm_settings: { detection_in_vitauri: true, profile_coc_mode: 'first_overrun', case_grouping: 'per_rule_customer', auto_case_sanctions: true,
    detection: { structuring: { amount_min: 1000, senders_by_class: { Low: 6 } }, rapid: { window_hours: 24 } } } }];
  for (const t of tenants) {
    if (f.detectionSettings) assert.deepEqual(f.detectionSettings(t), d.detectionSettings(t));
    if (f.caseGroupingSettings) assert.deepEqual(f.caseGroupingSettings(t), g.caseGroupingSettings(t));
  }
  assert.ok(f.detectionSettings && f.caseGroupingSettings);
});
