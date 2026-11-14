// Phase 3: detection on upload (spec tests 4, 5, 6). Fixture: the sample MT940, today = 3 Nov 2026,
// customer Lotte Vermeulen (NL, Medium), expected profile inbound <= 3,800.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  detectionSettings, DETECTION_DEFAULTS, riskClassOf, iso2, detectStructuring, detectRapidInOut,
  monthlyInbound, completedMonths, profileCocDue, alertSourceFor,
} from '../base44/shared/tmDetection.js';
import { summariseTxns, compareToProfile } from '../base44/shared/tmActuals.js';
import { submissionGroups } from '../base44/shared/tmSubmitOrder.js';
import { nowFor } from '../base44/shared/tmNow.js';
import { sampleLedger, AS_OF } from './helpers/sample.js';

const NOW = nowFor({ status: 'Demo' }, { as_of: AS_OF });
const CFG = detectionSettings({});
const LEDGER = sampleLedger(NOW);
const CLIENT = { id: 'c1', country_of_residence: 'Netherlands (NL)', risk_classification: 'Medium' };

test('settings: off by default, prototype values as defaults, tenant values win', () => {
  assert.equal(CFG.enabled, false);
  assert.deepEqual(CFG.structuring, DETECTION_DEFAULTS.structuring);
  assert.equal(CFG.rapid.window_hours, 48);
  assert.equal(CFG.profile_coc_mode, 'structural');
  const t = detectionSettings({ tm_settings: { detection_in_vitauri: true, profile_coc_mode: 'first_overrun', detection: { structuring: { senders_by_class: { Medium: 6 }, window_days: 5 }, rapid: { min_ratio: 0.9 } } } });
  assert.equal(t.enabled, true);
  assert.equal(t.structuring.senders_by_class.Medium, 6);
  assert.equal(t.structuring.senders_by_class.Low, 5);
  assert.equal(t.structuring.window_days, 5);
  assert.equal(t.rapid.min_ratio, 0.9);
  assert.equal(t.profile_coc_mode, 'first_overrun');
  assert.equal(detectionSettings({ tm_settings: { detection: { structuring: { window_days: -3, amount_min: 'x' } } } }).structuring.window_days, 7);
});

test('risk class: PEP is its own class; unknown ratings are not treated as low', () => {
  assert.equal(riskClassOf({ risk_classification: 'Low' }), 'Low');
  assert.equal(riskClassOf({ risk_classification: 'Medium' }), 'Medium');
  assert.equal(riskClassOf({ risk_classification: 'Unacceptable' }), 'High');
  assert.equal(riskClassOf({ risk_classification: 'Low' }, { pep: true }), 'PEP');
  assert.equal(riskClassOf({}), 'Medium');
  assert.equal(iso2('Netherlands (NL)'), 'NL');
  assert.equal(iso2('lt'), 'LT');
  assert.equal(iso2('Netherlands'), '');
});

test('spec test 4: one structuring alert, 6 senders, 14 to 20 Oct', () => {
  const f = detectStructuring(LEDGER, CFG, riskClassOf(CLIENT));
  assert.equal(f.length, 1);
  assert.equal(f[0].senders, 6);
  assert.equal(f[0].from, '2026-10-14');
  assert.equal(f[0].to, '2026-10-20');
  assert.equal(f[0].total, 1850 + 1920 + 1780 + 1990 + 1750 + 1890);
  assert.equal(f[0].transaction_ids.length, 6);
  assert.match(f[0].reason, /threshold for Medium: 4 senders/);
});

test('structuring follows the risk class threshold', () => {
  assert.equal(detectStructuring(LEDGER, CFG, 'Low').length, 1, 'Low needs 5, there are 6');
  const strict = detectionSettings({ tm_settings: { detection: { structuring: { senders_by_class: { Medium: 7 } } } } });
  assert.equal(detectStructuring(LEDGER, strict, 'Medium').length, 0);
});

test('structuring: a window of historical transactions only raises nothing', () => {
  const old = LEDGER.map((t) => ({ ...t, historical: true }));
  assert.equal(detectStructuring(old, CFG, 'Medium').length, 0);
});

test('structuring: the same sender several times is one sender', () => {
  const same = LEDGER.map((t) => (t.amount >= 1750 && t.amount < 2000 ? { ...t, counterparty_account_id: 'NL86INGB0002445588' } : t));
  assert.equal(detectStructuring(same, CFG, 'Medium').length, 0);
});

test('spec test 5: two rapid in/out alerts, 5,000 on 16 Oct and 5,100 on 21 Oct', () => {
  const f = detectRapidInOut(LEDGER, CFG, CLIENT.country_of_residence);
  assert.equal(f.length, 2);
  assert.deepEqual(f.map((x) => [x.date, x.amount, x.received, x.pct, x.country]), [
    ['2026-10-16', 5000, 5550, 90, 'LT'],
    ['2026-10-21', 5100, 5630, 91, 'LT'],
  ]);
  assert.equal(f[0].transaction_ids.length, 4);
});

test('rapid in/out: salary is not counted as money to pass on, domestic payments are left out', () => {
  // The rent (NL) and the 250 to PT on 5 Oct raise nothing
  const f = detectRapidInOut(LEDGER, CFG, 'NL');
  assert.ok(f.every((x) => x.country === 'LT'));
  // A foreign payment the day after salary: ignored because the only inflow is salary
  const extra = [...LEDGER, { id: 'x', client_id: 'c1', executed_at: '2026-10-26T12:00:00.000Z', direction: 'outbound', amount: 2800, counterparty_country: 'LT', lifecycle: 'booked', historical: false }];
  assert.equal(detectRapidInOut(extra, CFG, 'NL').length, 2);
  const noIgnore = detectionSettings({ tm_settings: { detection: { rapid: { ignore_inbound_references: [] } } } });
  assert.equal(detectRapidInOut(extra, noIgnore, 'NL').length, 3);
});

test('rapid in/out: historical outgoing payments are not tested; an unknown home country raises nothing', () => {
  assert.equal(detectRapidInOut(LEDGER.map((t) => ({ ...t, historical: true })), CFG, 'NL').length, 0);
  assert.equal(detectRapidInOut(LEDGER, CFG, '').length, 0);
});

test('spec test 6: inbound 14,080 in the last 30 days against a ceiling of 3,800', () => {
  const since = NOW.getTime() - 30 * 86400000;
  const recent = LEDGER.filter((t) => Date.parse(t.executed_at) >= since);
  const actuals = summariseTxns(recent, { client: CLIENT, reportingCurrency: 'EUR' });
  assert.equal(actuals.inbound, 14080);
  const cmp = compareToProfile(actuals, { inbound: 3800, inboundCount: null, outbound: null, foreignOut: null, cash: null }, [], 'EUR');
  assert.equal(cmp.breaches.length, 1);
  assert.match(cmp.breaches[0].reason, /Inbound EUR 14,080 vs limit 3,800/);
});

test('decision D7: change of circumstances on the first overrun, or only after N months above the ceiling', () => {
  const by = monthlyInbound(LEDGER);
  assert.deepEqual(by, { '2026-07': 2900, '2026-08': 2900, '2026-09': 2900, '2026-10': 14080 });
  assert.deepEqual(completedMonths(NOW, 2), ['2026-10', '2026-09']);
  const base = { months: 2, hasBreach: true, inboundByMonth: by, inboundLimit: 3800, now: NOW };
  assert.equal(profileCocDue({ ...base, mode: 'first_overrun' }), true);
  assert.equal(profileCocDue({ ...base, mode: 'structural' }), false, 'September was within the ceiling');
  assert.equal(profileCocDue({ ...base, mode: 'structural', inboundByMonth: { ...by, '2026-09': 5000 } }), true);
  assert.equal(profileCocDue({ ...base, mode: 'first_overrun', hasBreach: false }), false);
  assert.equal(profileCocDue({ ...base, mode: 'structural', months: 1 }), true);
});

test('alert source: only counterparty screening presets make it a provider alert (gap G14)', () => {
  assert.equal(alertSourceFor([{ rule_id: 'a', name: 'Sanctions counterparty matching' }]), 'didit_provider');
  assert.equal(alertSourceFor([{ rule_id: 'a', name: 'PEP counterparty exposure' }]), 'didit_provider');
  assert.equal(alertSourceFor([{ rule_id: 'a', name: 'PEP counterparty exposure' }, { rule_id: 'b', name: 'Smurfing via private senders (v1)' }]), 'didit_rule');
  assert.equal(alertSourceFor([{ rule_id: 'b', name: 'Rapid in and out (v2)' }]), 'didit_rule');
  assert.equal(alertSourceFor([]), 'didit_rule');
});

test('submission order: per customer by execution date, customers apart', () => {
  const g = submissionGroups([
    { id: 1, client_id: 'a', executed_at: '2026-10-20T12:00:00Z' }, { id: 2, client_id: 'b', executed_at: '2026-10-01T12:00:00Z' },
    { id: 3, client_id: 'a', executed_at: '2026-10-14T12:00:00Z' }, { id: 4, client_id: 'a', executed_at: '2026-10-14T12:00:00Z' },
    { id: 5, client_id: 'a' },
  ]);
  assert.deepEqual(g.map((l) => l.map((t) => t.id)), [[3, 4, 1, 5], [2]]);
  const recent = sampleLedger(NOW).filter((t) => !t.historical).reverse();
  const order = submissionGroups(recent)[0].map((t) => t.executed_at);
  assert.deepEqual(order, [...order].sort());
  assert.equal(order.length, 10);
});
