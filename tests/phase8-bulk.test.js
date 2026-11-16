// Phase 8: bulk import with an unmatched queue (spec test 12) and the manual transaction (spec test 14).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { FIXTURE, IBAN, loadSample } from './helpers/sample.js';
import { parseMt940 } from '../base44/shared/tmStatementParse.js';
import {
  parseStatements, groupByAccount, pickAccount, matchAccounts, autoCommittable, manualTxnCheck, ibanNorm, MAX_BULK_ACCOUNTS,
} from '../base44/shared/tmBulkImport.js';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const sample = readFileSync(FIXTURE, 'utf8');
const UNKNOWN = 'NL91ABNA0417164300';
// A second statement for an account nobody has, and two daily statements for it.
const other = [
  ':20:NAB2610STMT2', `:25:${UNKNOWN}`, ':28C:00011/001', ':60F:C261001EUR500,00',
  ':61:2610021002C100,00NTRFNONREF', ':86:/TRTP/SEPA OVERBOEKING/IBAN/NL44RABO0123456789/NAME/A. JANSEN/REMI/TEST',
  ':62F:C261002EUR600,00',
  ':20:NAB2610STMT3', `:25:${UNKNOWN}`, ':28C:00012/001', ':60F:C261003EUR600,00',
  ':61:2610031003D50,00NTRFNONREF', ':86:/TRTP/SEPA OVERBOEKING/IBAN/NL20INGB0001234567/NAME/WINKEL/REMI/BOODSCHAPPEN',
  ':62F:C261003EUR550,00',
].join('\r\n');
const twoAccounts = `${sample.replace(/\s+$/, '')}\r\n${other}\r\n`;

test('a single-statement file is read exactly as before', () => {
  const list = parseStatements('mt940', sample);
  assert.equal(list.length, 1);
  assert.deepEqual(list[0], parseMt940(sample));
  const { parsed } = loadSample();
  const one = pickAccount(groupByAccount(list), IBAN);
  assert.equal(one.rows.length, parsed.rows.length);
  assert.equal(one.opening, 1250);
  assert.equal(one.closing, 9730);
});

test('MT940 with several statements: one result per statement, merged per account', () => {
  const list = parseStatements('mt940', twoAccounts);
  assert.equal(list.length, 3);
  const groups = groupByAccount(list);
  assert.deepEqual(groups.map((g) => g.iban).sort(), [IBAN, UNKNOWN].sort());
  const u = groups.find((g) => g.iban === UNKNOWN);
  assert.equal(u.statements, 2);
  assert.equal(u.rows.length, 2);
  assert.equal(u.opening, 500);   // first day's opening
  assert.equal(u.closing, 550);   // last day's closing
  assert.equal(u.period_from, '2026-10-01');
  assert.equal(u.period_to, '2026-10-03');
  // the known account is untouched by the other statements
  assert.equal(groups.find((g) => g.iban === IBAN).rows.length, 18);
  // the old single parser would have merged all 20 rows under the first IBAN
  assert.equal(parseMt940(twoAccounts).rows.length, 20);
});

test('spec test 12: the known IBAN is matched, the unknown one goes to the unmatched queue', () => {
  const groups = groupByAccount(parseStatements('mt940', twoAccounts));
  const accounts = [{ id: 'a1', client_id: 'lotte', iban_or_number: 'NL02 ABNA 0123 4567 89', status: 'active' }];
  const { matched, unmatched } = matchAccounts(groups, accounts);
  assert.equal(matched.length, 1);
  assert.equal(matched[0].account.id, 'a1');
  assert.equal(matched[0].group.rows.length, 18);
  assert.equal(unmatched.length, 1);
  assert.equal(unmatched[0].reason, 'unknown_iban');
  assert.equal(unmatched[0].group.iban, UNKNOWN);
});

test('matching: closed accounts do not match, an IBAN on two customers is ambiguous, no reference cannot match', () => {
  const g = [{ iban: IBAN, rows: [{}] }, { iban: '', rows: [{}] }, { iban: UNKNOWN, rows: [] }];
  assert.equal(matchAccounts(g, [{ id: 'a', client_id: 'c1', iban_or_number: IBAN, status: 'closed' }]).unmatched[0].reason, 'unknown_iban');
  const amb = matchAccounts(g, [{ id: 'a', client_id: 'c1', iban_or_number: IBAN }, { id: 'b', client_id: 'c2', iban_or_number: IBAN }]);
  assert.equal(amb.matched.length, 0);
  assert.deepEqual(amb.unmatched.map((u) => u.reason), ['ambiguous', 'no_account_reference', 'no_transactions']);
  // a joint account registered twice for the same customer is not ambiguous
  assert.equal(matchAccounts([g[0]], [{ id: 'a', client_id: 'c1', iban_or_number: IBAN }, { id: 'b', client_id: 'c1', iban_or_number: IBAN }]).matched.length, 1);
  assert.equal(ibanNorm(' nl02-abna 0123456789 '), IBAN);
  assert.equal(pickAccount([{ iban: IBAN, rows: [] }], 'NL00NONE'), null);
  assert.ok(MAX_BULK_ACCOUNTS >= 10);
});

test('CAMT.053 with two statements gives two results', () => {
  const stmt = (iban, amt) => `<Stmt><Acct><Id><IBAN>${iban}</IBAN></Id></Acct>
    <Bal><Tp><CdOrPrtry><Cd>OPBD</Cd></CdOrPrtry></Tp><Amt Ccy="EUR">100.00</Amt><CdtDbtInd>CRDT</CdtDbtInd><Dt><Dt>2026-10-01</Dt></Dt></Bal>
    <Bal><Tp><CdOrPrtry><Cd>CLBD</Cd></CdOrPrtry></Tp><Amt Ccy="EUR">${(100 + amt).toFixed(2)}</Amt><CdtDbtInd>CRDT</CdtDbtInd><Dt><Dt>2026-10-02</Dt></Dt></Bal>
    <Ntry><Amt Ccy="EUR">${amt.toFixed(2)}</Amt><CdtDbtInd>CRDT</CdtDbtInd><BookgDt><Dt>2026-10-02</Dt></BookgDt></Ntry></Stmt>`;
  const xml = `<Document><BkToCstmrStmt>${stmt(IBAN, 25)}${stmt(UNKNOWN, 40)}</BkToCstmrStmt></Document>`;
  const groups = groupByAccount(parseStatements('camt053', xml));
  assert.equal(groups.length, 2);
  assert.equal(groups.find((g) => g.iban === UNKNOWN).rows[0].amount, 40);
  assert.equal(groups.find((g) => g.iban === IBAN).closing, 125);
  assert.throws(() => parseStatements('camt053', '<x/>'), /No Stmt/);
  assert.throws(() => parseStatements('csv', 'a,b'), /MT940 and CAMT/);
});

test('a statement is processed without review only when nothing blocks and the balance does not fail', () => {
  assert.equal(autoCommittable({ blocking: [], reconciles: true }), true);
  assert.equal(autoCommittable({ blocking: [], reconciles: null }), true);
  assert.equal(autoCommittable({ blocking: [], reconciles: false }), false);
  assert.equal(autoCommittable({ blocking: [{ code: 'iban_mismatch' }], reconciles: true }), false);
});

test('spec test 14: a manual transaction needs account and execution date with the new layout', () => {
  const now = new Date('2026-11-03T12:00:00Z');
  assert.match(manualTxnCheck({}, { v2: true, now }).error, /account is required/);
  assert.match(manualTxnCheck({ bank_account_id: 'a1' }, { v2: true, now }).error, /execution date is required/);
  assert.match(manualTxnCheck({ bank_account_id: 'a1', executed_at: 'yesterday-ish' }, { v2: true, now }).error, /not a valid date/);
  assert.match(manualTxnCheck({ bank_account_id: 'a1', executed_at: '2026-11-04T12:00:00Z' }, { v2: true, now }).error, /future/);
  assert.deepEqual(manualTxnCheck({ bank_account_id: 'a1', executed_at: '2026-10-20T09:30:00Z' }, { v2: true, now }), { bank_account_id: 'a1', executed_at: '2026-10-20T09:30:00.000Z' });
});

test('manual transaction with the flag off: nothing is required, and the row is dated now as before', () => {
  assert.deepEqual(manualTxnCheck({}, { v2: false }), { bank_account_id: null, executed_at: null });
  const fn = read('base44/functions/createDiditTransaction/entry.ts');
  assert.ok(fn.includes('manualTxnCheck(body, { v2: amlV2On(tenant) })'));
  assert.ok(fn.includes('executed_at: extra.executed_at || nowIso'));
  assert.ok(fn.includes("bankAccount.client_id !== client_id"));
  // the Didit call itself is unchanged: same body builder, same idempotency id
  assert.ok(fn.includes('buildTransactionBody(record, client, ourTransactionId, tenantId, null)'));
  assert.ok(fn.includes('`vt_m_${crypto.randomUUID()'));
});

test('wiring: new entity is tenant-scoped and backend-written; parseStatement reads one account when asked', () => {
  const ent = JSON.parse(read('base44/entities/UnmatchedStatement.jsonc'));
  assert.ok(ent.required.includes('tenant_id'));
  assert.equal(ent.rls.create.user_condition['data.app_role'], '__backend_only__');
  assert.equal(ent.rls.update.user_condition['data.app_role'], '__backend_only__');
  assert.ok(JSON.stringify(ent.rls.read).includes('{{user.data.tenant_id}}'));
  assert.equal(JSON.parse(read('base44/entities/StatementUpload.jsonc')).properties.account_filter.type, 'string');
  const ps = read('base44/functions/parseStatement/entry.ts');
  assert.ok(ps.includes('upload.account_filter') && ps.includes('pickAccount(groups, upload.account_filter)'));
  const bulk = read('base44/functions/bulkImportStatements/entry.ts');
  assert.ok(bulk.includes('amlV2On(tenant)') && bulk.includes('roles: ACCOUNT_ROLES'));
  assert.ok(read('base44/functions/resolveUnmatchedStatement/entry.ts').includes("'manageBankAccount'"));
});
