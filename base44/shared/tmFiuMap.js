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

export const MAX_MAPPED_TXNS = 500;
export const mappedTxnCount = (txns) => Math.min(txns.length, MAX_MAPPED_TXNS);

// Payment method -> transmode code. Empty when unknown.
const TRANSMODE = { bank_account: 'bank_transfer', bank_card: 'card', crypto_wallet: 'crypto', unhosted_wallet: 'crypto', ewallet: 'e_wallet' };
const round2 = (n) => Math.round(n * 100) / 100;
const isUboRole = (role) => /ubo|beneficial/i.test(s(role));
const isDirectorRole = (role) => /director|board/i.test(s(role));

function addTransactions(add, { client, accounts, txns, counterparties, cur }) {
  const sorted = sortedTxns(txns);
  const cps = new Map(counterparties.map((c) => [c.id, c]));
  const accs = new Map(accounts.map((a) => [a.id, a]));
  let totalIn = 0;
  let totalOut = 0;
  for (const t of sorted) {
    const amt = t.fx?.amount_reporting ?? amountInReporting(t, cur);
    if (amt == null) continue;
    if (t.direction === 'inbound') totalIn += Number(amt); else if (t.direction === 'outbound') totalOut += Number(amt);
  }
  add('transactions.count', 'Number of transactions', sorted.length, 'Ledger');
  add('transactions.total_in', `Total inbound (${cur})`, round2(totalIn), 'Ledger');
  add('transactions.total_out', `Total outbound (${cur})`, round2(totalOut), 'Ledger');
  if (sorted.length > MAX_MAPPED_TXNS) add('transactions.truncated', 'Warning', `Only the first ${MAX_MAPPED_TXNS} of ${sorted.length} transactions are mapped.`, 'Ledger');

  sorted.slice(0, MAX_MAPPED_TXNS).forEach((t, i) => {
    const p = `transaction[${i}]`;
    const n = `Transaction ${i + 1}`;
    const cp = cps.get(t.counterparty_id);
    const cpName = cp?.display_name || t.counterparty_name;
    const ownAccount = accs.get(t.bank_account_id)?.iban_or_number;
    const inbound = t.direction === 'inbound';
    const reporting = t.fx?.amount_reporting ?? amountInReporting(t, cur);
    add(`${p}.date_transaction`, `${n}: date`, day(t.executed_at), 'Ledger');
    add(`${p}.amount_local`, `${n}: amount`, t.amount, 'Ledger');
    add(`${p}.currency_code`, `${n}: currency`, t.currency, 'Ledger');
    if (reporting != null) add(`${p}.amount_reporting`, `${n}: amount (${cur})`, round2(Number(reporting)), 'Ledger');
    add(`${p}.direction`, `${n}: direction`, t.direction, 'Ledger');
    add(`${p}.transmode_code`, `${n}: transmission mode`, TRANSMODE[t.counterparty_method_type] || '', 'Ledger');
    add(`${p}.description`, `${n}: description`, t.description_raw, 'Ledger');
    add(`${p}.lifecycle`, `${n}: lifecycle`, t.lifecycle, 'Ledger');
    add(`${p}.from_party`, `${n}: from`, inbound ? cpName : client.full_name, inbound ? 'Entity resolution' : 'Ledger');
    add(`${p}.to_party`, `${n}: to`, inbound ? client.full_name : cpName, inbound ? 'Ledger' : 'Entity resolution');
    add(`${p}.from_account`, `${n}: from account`, inbound ? t.counterparty_account_id : ownAccount, inbound ? 'Entity resolution' : 'Ledger');
    add(`${p}.to_account`, `${n}: to account`, inbound ? ownAccount : t.counterparty_account_id, inbound ? 'Ledger' : 'Entity resolution');
    add(`${p}.counterparty_country`, `${n}: counterparty country`, t.counterparty_country || cp?.country, 'Entity resolution');
  });
}

export function buildFields({ tenant, officer, reportType, indicatorCodes, client, accounts, txns, counterparties, parties, cur, reason, idv }) {
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
    add('t_entity.incorporation_legal_form', 'Legal form', client.legal_form, 'KYC file');
    add('t_entity.business', 'Business', client.business_activity || client.sector, 'KYC file');
    add('t_entity.nature_of_business_code', 'Nature of business code', client.nature_of_business_code, 'KYC file');
    const ubos = parties.filter((p) => isUboRole(p.role)).sort((a, b) => (b.ownership_percentage ?? -1) - (a.ownership_percentage ?? -1));
    const directors = parties.filter((p) => !isUboRole(p.role) && isDirectorRole(p.role));
    [...ubos, ...directors].slice(0, 20).forEach((p, i) => {
      const d = `director_id[${i}]`;
      const n = `${isUboRole(p.role) ? 'UBO' : 'Director'} ${i + 1}`;
      add(`${d}.role`, `${n}: role`, p.role, 'KYC file');
      add(`${d}.full_name`, `${n}: name`, p.full_name, 'KYC file');
      add(`${d}.birthdate`, `${n}: date of birth`, p.date_of_birth, 'KYC file');
      add(`${d}.nationality`, `${n}: nationality`, p.nationality, 'KYC file');
      add(`${d}.country_of_residence`, `${n}: country of residence`, p.country_of_residence, 'KYC file');
      add(`${d}.identification.type`, `${n}: ID document type`, p.id_type, 'KYC file');
      add(`${d}.identification.number`, `${n}: ID document number`, p.id_number, 'KYC file');
      add(`${d}.identification.expiry_date`, `${n}: ID document expiry`, p.id_expiry_date, 'KYC file');
      add(`${d}.ownership_percentage`, `${n}: ownership %`, p.ownership_percentage, 'KYC file');
    });
  } else {
    add('t_person.first_name', 'First name(s)', client.first_names, 'KYC file');
    add('t_person.last_name', 'Last name', client.last_name, 'KYC file');
    add('t_person.birthdate', 'Date of birth', client.date_of_birth, 'KYC file');
    add('t_person.birth_place', 'Place of birth', client.place_of_birth, 'KYC file');
    add('t_person.nationality1', 'Nationality', client.nationality, 'KYC file');
    if (idv) {
      add('t_person.identification.type', 'ID document type', idv.idv_document_type, 'Didit');
      add('t_person.identification.number', 'ID document number', idv.idv_document_number, 'Didit');
      add('t_person.identification.expiry_date', 'ID document expiry', idv.idv_document_expiry, 'Didit');
      add('t_person.identification.issue_country', 'ID issuing country', idv.idv_issuing_country, 'Didit');
    } else {
      add('t_person.identification.type', 'ID document type', client.id_type, 'KYC file');
      add('t_person.identification.number', 'ID document number', client.id_number, 'KYC file');
    }
    add('t_person.occupation', 'Occupation', client.occupation, 'KYC file');
    add('t_person.employer_name', 'Employer', client.employer_name, 'KYC file');
    add('t_person.addresses.address.address', 'Address', addr(client.residential_address), 'KYC file');
  }

  const acc = accounts[0];
  if (acc) add('t_from_my_client.from_account.account', 'Account', acc.iban_or_number, ['psd2', 'upload'].includes(acc.source_type) ? 'Statement/PSD2' : 'KYC file');

  addTransactions(add, { client, accounts, txns, counterparties, cur });

  counterparties.slice(0, 10).forEach((c, i) => {
    add(`counterparty[${i}].name`, 'Counterparty', c.display_name, 'Entity resolution');
    add(`counterparty[${i}].country`, 'Counterparty country', c.country, 'Entity resolution');
    add(`counterparty[${i}].screening`, 'Screening result', c.screening_status, 'Didit screening');
  });
  return out;
}

// Index-insensitive path key: transaction[3].amount_local, transaction[*].amount_local and transaction.amount_local are the same.
const pathKey = (p) => s(p).replace(/\[(\d+|\*)\]/g, '');

/** Mandatory goAML paths that no mapped field fills. Natural-person paths do not apply to ORG; director_id[*] paths apply only to ORG. */
export function missingFields(mandatory, fields, client) {
  const isOrg = client.client_type === 'ORG';
  const filled = new Set(fields.map((f) => pathKey(f.path)));
  return (mandatory || [])
    .filter((p) => !(isOrg && p.startsWith('t_person.')))
    .filter((p) => isOrg || !p.startsWith('director_id'))
    .filter((p) => !filled.has(pathKey(p)));
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