// The sample statement through the existing parser and checks (plan section 1, "What the sample MT940 does today").
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseMt940, decorateRow, detectFormat, round2 } from '../base44/shared/tmStatementParse.js';
import { reconcile, findGaps, signed } from '../base44/shared/tmStatementChecks.js';

export const FIXTURE = new URL('../docs/kyc-aml/Lotte_Vermeulen_NL02ABNA0123456789_Jul-Oct2026.mt940', import.meta.url);
export const IBAN = 'NL02ABNA0123456789';

export function loadSample() {
  const bytes = readFileSync(FIXTURE);
  const parsed = parseMt940(bytes.toString('utf8'));
  parsed.rows.forEach((r) => decorateRow(r, parsed.account_ref));
  return { bytes, parsed };
}

test('format is detected as MT940', () => {
  const { bytes } = loadSample();
  assert.equal(detectFormat('Lotte_Vermeulen_NL02ABNA0123456789_Jul-Oct2026.mt940', new Uint8Array(bytes)), 'mt940');
});

test('account IBAN is read from :25:', () => {
  const { parsed } = loadSample();
  assert.equal(String(parsed.account_ref).replace(/\s/g, '').toUpperCase(), IBAN);
  assert.equal(parsed.currency, 'EUR');
});

test('balance reconciles: 1,250.00 + 8,480.00 = 9,730.00', () => {
  const { parsed } = loadSample();
  assert.equal(parsed.opening, 1250);
  assert.equal(parsed.closing, 9730);
  assert.equal(round2(parsed.rows.reduce((s, r) => s + signed(r), 0)), 8480);
  assert.deepEqual(reconcile(parsed.rows, parsed.opening, parsed.closing), { reconciles: true, diff: 0 });
});

test('18 transactions from 2026-07-25 to 2026-10-25', () => {
  const { parsed } = loadSample();
  const dates = parsed.rows.map((r) => r.date).sort();
  assert.equal(parsed.rows.length, 18);
  assert.equal(dates[0], '2026-07-25');
  assert.equal(dates[dates.length - 1], '2026-10-25');
  assert.ok(parsed.rows.every((r) => r.amount > 0 && ['inbound', 'outbound'].includes(r.direction)));
});

test('11 distinct counterparty IBANs, every row has a name from /NAME/', () => {
  const { parsed } = loadSample();
  const ibans = new Set(parsed.rows.map((r) => r.counterparty_account_id).filter(Boolean));
  assert.equal(ibans.size, 11);
  assert.ok(!ibans.has(IBAN), 'the account itself is not a counterparty');
  assert.ok(parsed.rows.every((r) => r.counterparty_name && r.counterparty_name.trim()));
});

// Known behaviour TODAY that Phase 1 (gap G4) changes: a reconciling statement on a "daily" account still reports
// every empty day as missing. When Phase 1 lands, this expectation must become 0 gap days.
test('coverage today (to change in Phase 1): 107 empty days reported as gaps for a daily account', () => {
  const { parsed } = loadSample();
  const rec = reconcile(parsed.rows, parsed.opening, parsed.closing);
  const gaps = findGaps({
    rows: parsed.rows, periodFrom: parsed.period_from, periodTo: parsed.period_to, opening: parsed.opening, closing: parsed.closing,
    hasRowBalances: false, expectedFrequency: 'daily', reconciles: rec.reconciles,
  });
  const days = gaps.reduce((n, g) => n + (Date.parse(g.to) - Date.parse(g.from)) / 86400000 + 1, 0);
  assert.equal(days, 107);
});
