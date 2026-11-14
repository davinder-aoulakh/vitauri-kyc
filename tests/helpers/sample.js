// The sample MT940 (client Lotte Vermeulen), parsed with the existing parser. Shared by the test files.
import { readFileSync } from 'node:fs';
import { parseMt940, decorateRow } from '../../base44/shared/tmStatementParse.js';

export const FIXTURE = new URL('../../docs/kyc-aml/Lotte_Vermeulen_NL02ABNA0123456789_Jul-Oct2026.mt940', import.meta.url);
export const IBAN = 'NL02ABNA0123456789';
export const AS_OF = '2026-11-03';

export function loadSample() {
  const bytes = readFileSync(FIXTURE);
  const parsed = parseMt940(bytes.toString('utf8'));
  parsed.rows.forEach((r) => decorateRow(r, parsed.account_ref));
  return { bytes, parsed };
}

/** The sample as ledger transactions, as they would be stored at `now` with a 30-day window (Phase 3 tests). */
export function sampleLedger(now, { windowDays = 30 } = {}) {
  const { parsed } = loadSample();
  return parsed.rows.map((r, i) => ({
    id: `t${i + 1}`, client_id: 'c1', executed_at: `${r.date}T12:00:00.000Z`, direction: r.direction, amount: r.amount, currency: 'EUR',
    counterparty_name: r.counterparty_name, counterparty_account_id: r.counterparty_account_id,
    counterparty_country: String(r.counterparty_account_id || '').slice(0, 2), reference: r.reference, description_raw: r.description,
    lifecycle: 'booked', own_transfer: false,
    historical: Math.floor((now.getTime() - Date.parse(`${r.date}T00:00:00Z`)) / 86400000) > windowDays,
  }));
}
