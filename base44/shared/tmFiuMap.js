// Pure mapping helpers for FIU report preparation: profile resolution, goAML field mapping, missing fields, snapshot.
import { amountInReporting } from './tmActuals.js';

const s = (v) => (v === undefined || v === null ? '' : String(v).trim());
export const distinct = (arr) => [...new Set(arr.filter(Boolean))];
const day = (iso) => s(iso).slice(0, 10);
const addr = (a) => (a ? [a.street, a.number, a.zipcode, a.city, a.country].map(s).filter(Boolean).join(' ') : '');

const CW_NAMES = ['cw', 'cuw', 'curacao', 'curaçao'];

/** CW when the client's residence (NP) or registered country (ORG) is Curaçao, otherwise NL. */
export function resolveProfileCode(client) {
  const country = client.client_type === 'ORG' ? client.registered_country : client.country_of_residence;
  return CW_NAMES.includes(s(country).toLowerCase()) ? 'CW' : 'NL';
}

const sortedTxns = (txns) => [...txns].sort((a, b) => s(a.executed_at).localeCompare(s(b.executed_at)));

export function buildFields({ tenant, officer, reportType, indicatorCodes, client, accounts, txns, counterparties, parties, cur, reason }) {
  const out = [];
  const add = (path, label, value, source, by = 'system') => { const v = s(value); if (v) out.push({ path, label, value: v, source, by }); };

  add('reporting_entity.id', 'Reporting entity', tenant.name, 'tenant');
  add('reporting_entity.reporting_person', 'Reporting officer', officer?.full_name || officer?.email, 'Didit template');
  add('report.type', 'Report type', reportType, 'TM scenario');
  add('report.indicator', 'Indicators', indicatorCodes.join(', '), 'FIU profile', 'agent');
  add('report.reason', 'Reason for reporting', reason, 'TmNarrative', 'agent');

  if (client.client_type === 'ORG') {
    add('t_entity.name', 'Entity name', client.full_name, 'KYC file');
    add('t_entity.incorporation_number', 'Registration number', client.registration_number, 'KYC file');
    add('t_entity.incorporation_country_code', 'Registered country', client.registered_country, 'KYC file');
    add('t_entity.address', 'Registered address', client.registered_address, 'KYC file');
    parties.slice(0, 20).forEach((p, i) => add(`related_party[${i}]`, p.role || 'Related party', `${p.full_name}${p.ownership_percentage != null ? ` (${p.ownership_percentage}%)` : ''}`, 'KYC file'));
  } else {
    add('t_person.first_name', 'First name(s)', client.first_names, 'KYC file');
    add('t_person.last_name', 'Last name', client.last_name, 'KYC file');
    add('t_person.birthdate', 'Date of birth', client.date_of_birth, 'KYC file');
    add('t_person.birth_place', 'Place of birth', client.place_of_birth, 'KYC file');
    add('t_person.nationality1', 'Nationality', client.nationality, 'KYC file');
    add('t_person.identification.type', 'ID document type', client.id_type, 'KYC file');
    add('t_person.identification.number', 'ID document number', client.id_number, 'KYC file');
    add('t_person.addresses.address.address', 'Address', addr(client.residential_address), 'KYC file');
  }

  const acc = accounts[0];
  if (acc) add('t_from_my_client.from_account.account', 'Account', acc.iban_or_number, ['psd2', 'upload'].includes(acc.source_type) ? 'Statement/PSD2' : 'KYC file');

  const first = sortedTxns(txns)[0];
  if (first) {
    add('transaction.date_transaction', 'Transaction date', day(first.executed_at), 'Ledger');
    const amount = amountInReporting(first, cur);
    if (amount != null) { add('transaction.amount_local', 'Amount (reporting currency)', amount, 'Ledger'); add('transaction.currency_code', 'Currency', cur, 'Ledger'); }
  }

  counterparties.slice(0, 10).forEach((c, i) => {
    add(`counterparty[${i}].name`, 'Counterparty', c.display_name, 'Entity resolution');
    add(`counterparty[${i}].country`, 'Counterparty country', c.country, 'Entity resolution');
    add(`counterparty[${i}].screening`, 'Screening result', c.screening_status, 'Didit screening');
  });
  return out;
}

/** Mandatory goAML paths that no mapped field fills. For organisations the natural-person paths do not apply. */
export function missingFields(mandatory, fields, client) {
  const filled = new Set(fields.map((f) => f.path));
  return (mandatory || []).filter((p) => !(client.client_type === 'ORG' && p.startsWith('t_person.'))).filter((p) => !filled.has(p));
}

export function buildAttachments({ docs, statements, analyses, outreach }) {
  const item = (kind, ref_type, ref_id, label) => ({ kind, ref_type, ref_id, label, selected: false });
  return [
    ...docs.filter((d) => ['Passport', 'ID_Card'].includes(d.doc_type)).map((d) => item('id_copy', 'Document', d.id, d.file_name || d.doc_type)),
    ...docs.filter((d) => d.doc_type === 'Financial_Statement').map((d) => item('statement', 'Document', d.id, d.file_name || 'Financial statement')),
    ...statements.map((u) => item('statement', 'StatementUpload', u.id, u.file_name || 'Bank statement')),
    ...analyses.map((a) => item('kyc_transaction_analysis', 'KycTransactionAnalysis', a.id, `KYC transaction analysis ${a.period_from || ''} – ${a.period_to || ''}`.trim())),
    ...outreach.map((o) => item('correspondence', 'OutreachRequest', o.id, `Customer request (${o.status || 'Draft'})`)),
  ];
}

export function buildSnapshot({ txns, counterparties, accounts, attachments, parties, extra = {} }) {
  return {
    transactions: sortedTxns(txns).slice(0, 200).map((t) => ({
      id: t.id, date: day(t.executed_at), amount: t.amount, currency: t.currency, direction: t.direction,
      counterparty: t.counterparty_name, counterparty_id: t.counterparty_id, method: t.counterparty_method_type, description: t.description_raw, lifecycle: t.lifecycle,
    })),
    counterparties: counterparties.map((c) => ({ id: c.id, name: c.display_name, country: c.country, screening_status: c.screening_status })),
    accounts: accounts.map((a) => ({ id: a.id, number: a.iban_or_number, institution: a.institution, currency: a.currency, source_type: a.source_type })),
    related_parties: parties.map((p) => ({ id: p.id, name: p.full_name, role: p.role, ownership_percentage: p.ownership_percentage })),
    attachments,
    ...extra,
  };
}