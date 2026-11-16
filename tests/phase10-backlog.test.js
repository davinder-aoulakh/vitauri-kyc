// Phase 10: profile sources and the declaration gap (G20), behaviour-score threshold, CSV mapping templates.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  PROFILE_SOURCES, LIMIT_FIELDS, DEFAULT_SEGMENT_LIMITS, segmentOf, segmentDefaults, declaredValues, fillFromSegment,
  fieldSources, overallSource, profileGap,
} from '../base44/shared/tmProfileSources.js';
import { limitsFromBehavior } from '../base44/shared/tmProfileMap.js';
import { behaviourThreshold, reachesThreshold, behaviourDedupeKey, behaviourFinding } from '../base44/shared/tmBehaviourProposal.js';
import { cleanTemplate, templatesOf, pickTemplate, templateFromUpload, MAX_TEMPLATES } from '../base44/shared/tmCsvTemplates.js';
import { parseCsv, parseMatrix, matchesSavedMap } from '../base44/shared/tmStatementParse.js';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const entity = (n) => JSON.parse(read(`base44/entities/${n}.jsonc`));

test('profile sources: the two new sources exist next to the old ones', () => {
  assert.deepEqual(PROFILE_SOURCES, ['kyc_case', 'kyc_txn_analysis', 'manual', 'tm_review', 'client_declaration', 'segment_default']);
  const p = entity('ExpectedProfile').properties;
  assert.deepEqual(p.source.enum, PROFILE_SOURCES);
  for (const f of ['declared_values', 'field_sources', 'finding_gap']) assert.equal(p[f].type, 'object', f);
});

test('segment of a customer and the tenant segment defaults', () => {
  assert.equal(segmentOf({ client_type: 'NP', risk_classification: 'Medium' }), 'NP_Medium');
  assert.equal(segmentOf({ client_type: 'ORG', risk_classification: 'Unacceptable' }), 'ORG_High');
  assert.equal(segmentOf({}), 'NP_Medium');
  assert.deepEqual(segmentDefaults({}), DEFAULT_SEGMENT_LIMITS);
  const own = segmentDefaults({ tm_settings: { segment_defaults: { NP_Medium: { inbound_max_month: 4000, cash_max_month: 'x' } } } });
  assert.equal(own.NP_Medium.inbound_max_month, 4000);
  assert.equal(own.NP_Medium.cash_max_month, DEFAULT_SEGMENT_LIMITS.NP_Medium.cash_max_month);
  assert.equal(own.ORG_Low.inbound_max_month, DEFAULT_SEGMENT_LIMITS.ORG_Low.inbound_max_month);
});

test('declared values come from the client\'s expected use; the segment default only fills what is empty', () => {
  const declared = declaredValues(limitsFromBehavior({ inbound_month: '3000', cash: 'none' }, 'NL').fields);
  assert.deepEqual(declared, { inbound_max_month: 3900, cash_max_month: 0 });
  const client = { client_type: 'NP', risk_classification: 'Medium' };
  const { fields, filled } = fillFromSegment(declared, client, {});
  assert.equal(fields.inbound_max_month, 3900);
  assert.equal(fields.cash_max_month, 0);
  assert.deepEqual(filled, ['outbound_max_month', 'max_single_txn']);
  assert.equal(fields.max_single_txn, DEFAULT_SEGMENT_LIMITS.NP_Medium.max_single_txn);
  assert.deepEqual(fillFromSegment(fields, client, {}).filled, []);
});

test('each limit names its source', () => {
  const declared = { inbound_max_month: 3900 };
  const src = fieldSources({
    fields: { inbound_max_month: 3900, outbound_max_month: 7500, max_single_txn: 2000, cash_max_month: 100 },
    declared, analysisFields: { cash_max_month: 100 }, segmentFilled: ['outbound_max_month'], overrides: { max_single_txn: 2000 },
  });
  assert.deepEqual(src, { inbound_max_month: 'client_declaration', outbound_max_month: 'segment_default', max_single_txn: 'manual', cash_max_month: 'kyc_txn_analysis' });
  assert.equal(overallSource({ a: 'segment_default', b: 'segment_default' }, 'manual'), 'segment_default');
  assert.equal(overallSource({ a: 'client_declaration' }, 'kyc_case'), 'client_declaration');
  assert.equal(overallSource(src, 'kyc_case'), 'kyc_case');
  assert.equal(overallSource({ a: 'kyc_txn_analysis' }, 'kyc_case'), 'kyc_case');
});

test('the gap between declaration and proposal is a finding beyond 25%', () => {
  assert.equal(profileGap({ inbound_max_month: 3900 }, { inbound_max_month: 4500 }), null);            // +15%
  const g = profileGap({ inbound_max_month: 3900, cash_max_month: 0 }, { inbound_max_month: 14080, cash_max_month: 500, max_single_txn: 9 });
  assert.equal(g.tolerance, 0.25);
  assert.deepEqual(g.fields.map((f) => [f.field, f.direction]), [['inbound_max_month', 'above'], ['cash_max_month', 'above']]);
  assert.equal(g.fields[0].ratio, 3.61);
  assert.equal(g.fields[1].ratio, null);
  assert.equal(profileGap({ outbound_max_month: 5000 }, { outbound_max_month: 2000 }).fields[0].direction, 'below');
  assert.equal(profileGap({}, { inbound_max_month: 1 }), null);
  assert.equal(profileGap({ cash_max_month: 0 }, { cash_max_month: 0 }), null);
  assert.deepEqual(LIMIT_FIELDS, ['inbound_max_month', 'outbound_max_month', 'max_single_txn', 'cash_max_month']);
});

test('behaviour-score threshold: off unless the tenant set a number between 1 and 100', () => {
  assert.equal(behaviourThreshold({}), null);
  assert.equal(behaviourThreshold({ tm_settings: { behaviour_proposal_threshold: '' } }), null);
  assert.equal(behaviourThreshold({ tm_settings: { behaviour_proposal_threshold: 0 } }), null);
  assert.equal(behaviourThreshold({ tm_settings: { behaviour_proposal_threshold: 150 } }), null);
  assert.equal(behaviourThreshold({ tm_settings: { behaviour_proposal_threshold: '70' } }), 70);
  assert.equal(reachesThreshold(69, 70), false);
  assert.equal(reachesThreshold(70, 70), true);
  assert.equal(reachesThreshold(95, null), false);
  assert.equal(behaviourDedupeKey('c1', new Date('2026-11-03T10:00:00Z')), 'c1:behaviour_score:2026-11');
  const f = behaviourFinding({ score: 82, threshold: 70, reasons: ['Inbound 14,080 against 3,800.'], riskScoreId: 'r1' });
  assert.match(f.after.summary, /Behaviour score 82 reached the tenant threshold of 70/);
  const risk = read('base44/shared/tmRisk.js');
  assert.ok(risk.includes('reachesThreshold(behaviour.score, bThreshold)') && risk.includes("trigger_type: 'risk_band_rise'"));
});

test('CSV templates: a name, a date header and an amount header are required', () => {
  assert.equal(cleanTemplate({ name: 'x', by_header: { date: 'Datum' } }), null);
  assert.equal(cleanTemplate({ name: '', by_header: { date: 'Datum', amount: 'Bedrag' } }), null);
  const t = cleanTemplate({ name: ' ABN AMRO CSV ', by_header: { date: 'Transactiedatum', debit: 'Af', credit: 'Bij', other: 'x', description: '  Omschrijving ' } });
  assert.deepEqual(t, { id: 'tpl_abn_amro_csv', name: 'ABN AMRO CSV', by_header: { date: 'Transactiedatum', debit: 'Af', credit: 'Bij', description: 'Omschrijving' } });
  const tenant = { tm_settings: { csv_templates: [t, t, { name: 'broken' }, { name: 'ING', by_header: { date: 'Datum', amount: 'Bedrag (EUR)' } }] } };
  assert.deepEqual(templatesOf(tenant).map((x) => x.name), ['ABN AMRO CSV', 'ING']);
  assert.deepEqual(templatesOf({}), []);
  assert.ok(MAX_TEMPLATES >= 10);
  assert.equal(templateFromUpload({ column_map: { by_header: { date: 'Date', amount: 'Amount' } } }, 'From upload').by_header.amount, 'Amount');
});

test('a file is read with the tenant template whose headers it has; otherwise detection works as before', () => {
  // "Boekbedrag" and "Tegenpartij rekening" are not headers the automatic detection knows
  const csv = 'Boekdatum;Boekbedrag;Naam tegenpartij;Mededeling\n2026-10-14;1850,00;J. de Boer;Lening\n2026-10-16;-5000,00;M. Vermeulen;Familie\n';
  const matrix = parseCsv(csv);
  const templates = templatesOf({ tm_settings: { csv_templates: [
    { name: 'Other bank', by_header: { date: 'Date', amount: 'Amount' } },
    { name: 'Regiobank', by_header: { date: 'Boekdatum', amount: 'Boekbedrag', counterparty: 'Naam tegenpartij', description: 'Mededeling' } },
  ] } });
  const picked = pickTemplate(matrix, templates, matchesSavedMap);
  assert.equal(picked.name, 'Regiobank');
  const parsed = parseMatrix(matrix, { by_header: picked.by_header });
  assert.equal(parsed.rows.length, 2);
  assert.deepEqual(parsed.rows.map((r) => [r.date, r.amount, r.direction, r.counterparty_name]), [['2026-10-14', 1850, 'inbound', 'J. de Boer'], ['2026-10-16', 5000, 'outbound', 'M. Vermeulen']]);
  assert.equal(pickTemplate(parseCsv('Date,Amount\n2026-10-01,10\n'), templates.slice(1), matchesSavedMap), null);
  const ps = read('base44/functions/parseStatement/entry.ts');
  assert.ok(ps.includes('pickTemplate(matrix, templatesOf(tenant), matchesSavedMap)') && ps.includes('mapping_template'));
  assert.equal(entity('StatementUpload').properties.mapping_template.type, 'string');
});

test('wiring: the profile function stores sources only with the new layout; the blocked items have a design note', () => {
  const fn = read('base44/functions/proposeExpectedProfile/entry.ts');
  assert.ok(fn.includes('const v2 = amlV2On(tenant);') && fn.includes('sourceInfo(') && fn.includes('fillFromSegment('));
  assert.ok(fn.includes('...(v2 ? merged : {})'));
  const doc = read('docs/kyc-aml/phase10-counterparty-psd2.md');
  assert.ok(doc.includes('Counterparty enrolment') && doc.includes('PSD2 partner') && doc.includes('No code was changed'));
});
