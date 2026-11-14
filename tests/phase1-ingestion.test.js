// Phase 1: historical window (G2), IBAN mismatch (G3), coverage (G4), account model (G6), reference fields (G7),
// re-upload (G5). Fixture: the sample MT940 with today = 3 Nov 2026.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseMt940, decorateRow, mt940Subfields } from '../base44/shared/tmStatementParse.js';
import { reconcile, findGaps, coveredEmptyDays, ibanMismatch } from '../base44/shared/tmStatementChecks.js';
import { assignKeys, buildItems, applyOverrides, execAt } from '../base44/shared/tmStatementRows.js';
import { toCanonical, countryFromIban } from '../base44/shared/tmCanonical.js';
import { nowFor } from '../base44/shared/tmNow.js';
import {
  historicalWindowDays, isHistorical, resolveHistorical, countHistorical, DEFAULT_HISTORICAL_WINDOW_DAYS,
} from '../base44/shared/tmHistorical.js';
import { pickFields, cleanHolders, snapshot } from '../base44/shared/bankAccountRules.js';
import { loadSample, FIXTURE, IBAN, AS_OF } from './helpers/sample.js';

const DEMO = { id: 't1', status: 'Demo', tm_timezone: 'Europe/Amsterdam' };
const NOW = nowFor(DEMO, { as_of: AS_OF });

// ── G2 historical window ──
test('window: default 30, tenant setting wins, nonsense falls back', () => {
  assert.equal(DEFAULT_HISTORICAL_WINDOW_DAYS, 30);
  assert.equal(historicalWindowDays({}), 30);
  assert.equal(historicalWindowDays({ tm_settings: { historical_window_days: 14 } }), 14);
  assert.equal(historicalWindowDays({ tm_settings: '{"historical_window_days": 60}' }), 60);
  for (const v of [0, -5, 'abc', 2.5, 99999, null]) assert.equal(historicalWindowDays({ tm_settings: { historical_window_days: v } }), 30, String(v));
});

test('isHistorical counts calendar days: day 30 is recent, day 31 is historical', () => {
  assert.equal(isHistorical('2026-10-04', NOW, 30), false);
  assert.equal(isHistorical('2026-10-03', NOW, 30), true);
  assert.equal(isHistorical('2026-10-03T12:00:00.000Z', NOW, 30), true);
  assert.equal(isHistorical('not a date', NOW, 30), false);
});

test('resolveHistorical: explicit value kept, intended never historical', () => {
  assert.equal(resolveHistorical({ historical: false, executedAt: '2020-01-01' }, NOW, 30), false);
  assert.equal(resolveHistorical({ historical: true, executedAt: '2026-11-03' }, NOW, 30), true);
  assert.equal(resolveHistorical({ lifecycle: 'intended', executedAt: '2020-01-01' }, NOW, 30), false);
  assert.equal(resolveHistorical({ lifecycle: 'booked', executedAt: '2026-08-01T12:00:00Z' }, NOW, 30), true);
});

test('spec tests 1 and 3: sample at 3 Nov 2026 = 8 historical, 10 recent', () => {
  const { parsed } = loadSample();
  assert.deepEqual(countHistorical(parsed.rows, NOW, 30), { historical: 8, recent: 10 });
  // The recent ones are exactly the rows from 5 Oct onward
  const recent = parsed.rows.filter((r) => !resolveHistorical({ executedAt: r.date }, NOW, 30)).map((r) => r.date).sort();
  assert.equal(recent[0], '2026-10-05');
});

test('the same rule serves the API channel: 8 to 30 days old is no longer historical', () => {
  assert.equal(resolveHistorical({ lifecycle: 'booked', executedAt: '2026-10-20T09:00:00Z' }, NOW, 30), false); // 14 days old
  assert.equal(resolveHistorical({ lifecycle: 'booked', executedAt: '2026-10-20T09:00:00Z' }, NOW, 7), true);  // tenant may still choose 7
});

test('as_of is ignored for an Active tenant: on the real calendar the window follows the real date', () => {
  const real = new Date('2026-12-24T10:00:00Z');
  const now = nowFor({ status: 'Active' }, { as_of: AS_OF }, { role: 'Tenant Admin' }, () => real);
  const { parsed } = loadSample();
  assert.equal(countHistorical(parsed.rows, now, 30).historical, 18);
});

// ── G3 IBAN mismatch ──
test('spec test 2: a statement for another IBAN gives a blocking check', () => {
  const text = readFileSync(FIXTURE, 'utf8').replace(':25:NL02ABNA0123456789', ':25:NL91ABNA0417164300');
  const other = parseMt940(text);
  assert.deepEqual(ibanMismatch(other.account_ref, IBAN), { code: 'iban_mismatch', file_iban: 'NL91ABNA0417164300', account_iban: IBAN });
});

test('no mismatch for the right account, spacing and case ignored, unknown side ignored', () => {
  const { parsed } = loadSample();
  assert.equal(ibanMismatch(parsed.account_ref, IBAN), null);
  assert.equal(ibanMismatch('nl02 abna 0123 4567 89', IBAN), null);
  assert.equal(ibanMismatch('', IBAN), null);
  assert.equal(ibanMismatch(IBAN, undefined), null);
});

// ── G4 coverage ──
test('coverage: 107 empty days of the sample are covered, none missing', () => {
  const { parsed } = loadSample();
  const rec = reconcile(parsed.rows, parsed.opening, parsed.closing);
  const covered = coveredEmptyDays({ rows: parsed.rows, periodFrom: parsed.period_from, periodTo: parsed.period_to, gaps: [], reconciles: rec.reconciles });
  assert.equal(covered.length, 107);
  const withRows = new Set(parsed.rows.map((r) => r.date));
  assert.ok(covered.every((d) => !withRows.has(d) && d >= parsed.period_from && d <= parsed.period_to));
});

test('coverage: a statement that does not reconcile still reports gaps and covers nothing', () => {
  const { parsed } = loadSample();
  const rec = reconcile(parsed.rows, parsed.opening, parsed.closing + 100);
  assert.equal(rec.reconciles, false);
  const gaps = findGaps({ rows: parsed.rows, periodFrom: parsed.period_from, periodTo: parsed.period_to, opening: parsed.opening, closing: parsed.closing + 100, hasRowBalances: false, expectedFrequency: 'monthly', reconciles: false });
  assert.ok(gaps.length > 0);
  assert.deepEqual(coveredEmptyDays({ rows: parsed.rows, periodFrom: parsed.period_from, periodTo: parsed.period_to, gaps, reconciles: false }), []);
});

test('coverage: without any balance a daily account keeps the old rule, a monthly one has no gaps', () => {
  const rows = [{ date: '2026-10-01', amount: 10, direction: 'inbound' }, { date: '2026-10-05', amount: 10, direction: 'inbound' }];
  const base = { rows, periodFrom: '2026-10-01', periodTo: '2026-10-05', opening: null, closing: null, hasRowBalances: false, reconciles: null };
  assert.deepEqual(findGaps({ ...base, expectedFrequency: 'daily' }), [{ from: '2026-10-02', to: '2026-10-04' }]);
  assert.deepEqual(findGaps({ ...base, expectedFrequency: 'monthly' }), []);
});

test('coverage: the cap is respected and gap days are not counted as covered', () => {
  const { parsed } = loadSample();
  const gaps = [{ from: '2026-07-02', to: '2026-07-10' }];
  const covered = coveredEmptyDays({ rows: parsed.rows, periodFrom: parsed.period_from, periodTo: parsed.period_to, gaps, reconciles: true });
  assert.equal(covered.length, 107 - 9);
  assert.equal(coveredEmptyDays({ rows: parsed.rows, periodFrom: parsed.period_from, periodTo: parsed.period_to, reconciles: true, max: 20 }).length, 20);
});

// ── G7 reference fields ──
test('MT940 subfields: IBAN, NAME, REMI and EREF are read explicitly', () => {
  const sub = mt940Subfields('/TRTP/SEPA OVERBOEKING/IBAN/NL44RABO0123456789/BIC/RABONL2U/NAME/VAN DALEN INSTALLATIETECHNIEK BV/REMI/SALARIS JULI 2026/EREF/NOTPROVIDED');
  assert.equal(sub.IBAN, 'NL44RABO0123456789');
  assert.equal(sub.BIC, 'RABONL2U');
  assert.equal(sub.NAME, 'VAN DALEN INSTALLATIETECHNIEK BV');
  assert.equal(sub.REMI, 'SALARIS JULI 2026');
  assert.deepEqual(mt940Subfields('free text without markers'), {});
  assert.equal(mt940Subfields('/NAME/A/B TRADING/REMI/INV 12/34').NAME, 'A/B TRADING');
});

test('every sample row has a counterparty IBAN and a reference; NOTPROVIDED is not stored as end-to-end id', () => {
  const parsed = parseMt940(readFileSync(FIXTURE, 'utf8'));
  assert.ok(parsed.rows.every((r) => /^[A-Z]{2}\d{2}/.test(r.counterparty_account_id)));
  assert.ok(parsed.rows.every((r) => r.reference && r.reference.length > 0));
  assert.ok(parsed.rows.every((r) => r.end_to_end_id === undefined));
  assert.equal(parsed.rows[0].reference, 'SALARIS JULI 2026');
  assert.equal(new Set(parsed.rows.map((r) => r.counterparty_account_id)).size, 11);
});

test('free-text :86: keeps working through the fallback', () => {
  const text = ':20:X\n:25:NL02ABNA0123456789\n:60F:C261001EUR100,00\n:61:2610021002C50,00NTRFNONREF\n:86:PAYMENT FROM J JANSEN NL91ABNA0417164300 RENT\n:62F:C261002EUR150,00\n';
  const p = parseMt940(text);
  p.rows.forEach((r) => decorateRow(r, p.account_ref));
  assert.equal(p.rows.length, 1);
  assert.equal(p.rows[0].reference, undefined);
  assert.equal(p.rows[0].counterparty_account_id, 'NL91ABNA0417164300');
});

test('counterparty country comes from the IBAN when it is not given', async () => {
  assert.equal(countryFromIban('LT121000011101001000'), 'LT');
  assert.equal(countryFromIban('12345678'), undefined);
  const base = { client_id: 'c1', executed_at: '2026-10-16T12:00:00.000Z', amount: 5000, direction: 'outbound', currency: 'EUR', description_raw: 'x' };
  const a = await toCanonical({ ...base, counterparty_account_id: 'LT121000011101001000', reference: ' INVESTMENT ', end_to_end_id: 'E2E-1' }, 'mt940', { tenant: DEMO, tenant_id: 't1' });
  assert.equal(a.record.counterparty_country, 'LT');
  assert.equal(a.record.reference, 'INVESTMENT');
  assert.equal(a.record.end_to_end_id, 'E2E-1');
  const b = await toCanonical({ ...base, counterparty_account_id: 'LT121000011101001000', counterparty_country: 'DE' }, 'api', { tenant: DEMO, tenant_id: 't1' });
  assert.equal(b.record.counterparty_country, 'DE', 'a given country is kept');
  const c = await toCanonical(base, 'api', { tenant: DEMO, tenant_id: 't1' });
  assert.equal('counterparty_country' in c.record, false);
  assert.equal('reference' in c.record, false);
});

// ── G5 / spec test 7: re-upload ──
test('dedupe keys do not depend on the new fields, so earlier uploads still match', async () => {
  const { parsed } = loadSample();
  const withNew = parsed.rows.map((r) => ({ ...r, currency: 'EUR' }));
  const without = parsed.rows.map((r) => ({ date: r.date, amount: r.amount, direction: r.direction, description: r.description, currency: 'EUR' }));
  await assignKeys({ tenantId: 't1', clientId: 'c1', accountId: 'a1', rows: withNew });
  await assignKeys({ tenantId: 't1', clientId: 'c1', accountId: 'a1', rows: without });
  assert.deepEqual(withNew.map((r) => r.dedupe_key), without.map((r) => r.dedupe_key));
  assert.equal(new Set(withNew.map((r) => r.dedupe_key)).size, 18);
});

test('first upload builds 18 items with reference; the second upload builds none (18 duplicates)', () => {
  const { parsed } = loadSample();
  const rows = parsed.rows.map((r, idx) => ({ ...r, idx, currency: 'EUR' }));
  const first = buildItems({ clientId: 'c1', accountId: 'a1', accountRef: IBAN, currency: 'EUR', rows });
  assert.equal(first.length, 18);
  assert.equal(first[0].item.reference, 'SALARIS JULI 2026');
  assert.equal(first[0].item.executed_at, execAt('2026-07-25'));
  assert.ok(first.every((b) => !('historical' in b.item)), 'the window is applied centrally, not by the upload');
  const again = applyOverrides(rows.map((r) => ({ ...r, duplicate: true })), {});
  assert.equal(buildItems({ clientId: 'c1', accountId: 'a1', accountRef: IBAN, currency: 'EUR', rows: again }).length, 0);
  assert.equal(again.filter((r) => r.duplicate && !r.excluded).length, 18);
});

// ── G6 account model ──
test('account type and holders are validated', () => {
  const f = pickFields({ account_type: 'joint', holders: [{ name: ' Lotte Vermeulen ', role: 'holder', client_id: 'c1' }, { name: '' }, null, { name: 'M. Vermeulen', extra: 'x' }] });
  assert.equal(f.account_type, 'joint');
  assert.deepEqual(f.holders, [{ name: 'Lotte Vermeulen', client_id: 'c1', role: 'holder' }, { name: 'M. Vermeulen' }]);
  assert.throws(() => pickFields({ account_type: 'savings' }), /Invalid account_type/);
  assert.throws(() => cleanHolders('Lotte'), /holders must be a list/);
  assert.throws(() => cleanHolders(Array.from({ length: 11 }, (_, i) => ({ name: `H${i}` }))), /At most 10/);
  assert.deepEqual(pickFields({ institution: 'ABN AMRO' }), { institution: 'ABN AMRO' }, 'fields not sent are not touched');
  assert.equal(snapshot({ account_type: 'own', holders: [] }).account_type, 'own');
});
