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
