// goAML XML builder (UNODC goAML "report" schema, element order as in the goAML XSD). Pure: no I/O.
// Built from the report's reviewed fields[] (the same values the four-eyes reviewers saw), plus the report record and FIU profile.
// Transaction types (STR, UTR, CTR, TTR, IFT, CBR) emit <transaction> elements; activity types (SAR, TFR) emit <activity>.
// Lookup codes (transmode / funds) come from each FIU's goAML lookup tables. Vitauri writes readable defaults (CASH, TRANSFER,
// CARD, CRYPTO, EWALLET, OTHER); confirm them against the FIU's tables before go-live (fiu.report_codes.lookups can override).
import { toIso2 } from './countryCodes.js';
import { FIU_TYPES, normaliseType, reportCodeFor, isCash } from './fiuTypes.js';

export const GOAML_REPORT_ORDER = [
  'rentity_id', 'rentity_branch', 'submission_code', 'report_code', 'entity_reference', 'fiu_ref_number', 'submission_date',
  'currency_code_local', 'reporting_person', 'location', 'reason', 'action', 'transaction', 'activity', 'report_indicators',
];
const TRANSMODE = { bank_transfer: 'TRANSFER', card: 'CARD', crypto: 'CRYPTO', e_wallet: 'EWALLET', cash: 'CASH' };

const s = (v) => (v === undefined || v === null ? '' : String(v).trim());
export const xmlEscape = (v) => s(v)
  .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');

/** goAML dateTime: yyyy-MM-ddTHH:mm:ss. '' when not a date. */
export function goamlDate(v) {
  const x = s(v);
  if (!x) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(x)) return `${x}T00:00:00`;
  const d = new Date(x);
  return Number.isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 19);
}
export const goamlAmount = (v) => { const n = Number(String(v ?? '').replace(/,/g, '')); return s(v) !== '' && Number.isFinite(n) ? Math.abs(n).toFixed(2) : ''; };

// Tree nodes: [name, value] or [name, [children]]. Empty values and empty groups are left out.
const node = (name, value) => [name, value];
function render(n, depth = 1) {
  const [name, v] = n;
  const pad = '  '.repeat(depth);
  if (Array.isArray(v)) {
    const inner = v.filter(Boolean).map((c) => render(c, depth + 1)).filter(Boolean);
    return inner.length ? `${pad}<${name}>\n${inner.join('\n')}\n${pad}</${name}>` : '';
  }
  const text = xmlEscape(v);
  return text ? `${pad}<${name}>${text}</${name}>` : '';
}

function fieldReader(fields) {
  const m = new Map((fields || []).map((f) => [f.path, s(f.value)]));
  return (p) => m.get(p) || '';
}

const address = (type, line, city, zip, country) => node('addresses', [node('address', [
  node('address_type', type), node('address', line), node('city', city), node('zip', zip), node('country_code', toIso2(country)),
])]);

function personNode(get, prefix) {
  const g = (k) => get(`${prefix}.${k}`);
  return [
    node('first_name', g('first_name')), node('last_name', g('last_name') || g('full_name')),
    node('birthdate', goamlDate(g('birthdate'))), node('birth_place', g('birth_place')),
    node('nationality1', toIso2(g('nationality1') || g('nationality'))),
    node('residence', toIso2(g('country_of_residence'))),
    g('addresses.address.address') ? address('P', g('addresses.address.address'), g('addresses.address.city'), g('addresses.address.zip'), g('addresses.address.country_code')) : null,
    node('occupation', g('occupation')), node('employer_name', g('employer_name')),
    g('identification.number') ? node('identification', [
      node('type', g('identification.type')), node('number', g('identification.number')),
      node('expiry_date', goamlDate(g('identification.expiry_date'))), node('issue_country', toIso2(g('identification.issue_country'))),
    ]) : null,
  ];
}

// director_id[i] carries full_name only: split into first / last name for t_person.
function directorNode(get, i) {
  const g = (k) => get(`director_id[${i}].${k}`);
  const parts = g('full_name').split(/\s+/).filter(Boolean);
  return node('director_id', [
    node('first_name', parts.slice(0, -1).join(' ')), node('last_name', parts.slice(-1)[0] || ''),
    node('birthdate', goamlDate(g('birthdate'))), node('nationality1', toIso2(g('nationality'))), node('residence', toIso2(g('country_of_residence'))),
    g('identification.number') ? node('identification', [node('type', g('identification.type')), node('number', g('identification.number')), node('expiry_date', goamlDate(g('identification.expiry_date')))]) : null,
    node('role', g('role')),
  ]);
}

function entityNode(get) {
  const directors = [...new Set((get.paths || []).map((p) => p.match(/^director_id\[(\d+)\]\./)?.[1]).filter((x) => x != null))].map(Number).sort((a, b) => a - b);
  return [
    node('name', get('t_entity.name')), node('incorporation_legal_form', get('t_entity.incorporation_legal_form')),
    node('incorporation_number', get('t_entity.incorporation_number')), node('business', get('t_entity.business')),
    get('t_entity.address') ? address('B', get('t_entity.address'), get('t_entity.addresses.address.city'), get('t_entity.addresses.address.zip'), get('t_entity.addresses.address.country_code')) : null,
    node('incorporation_country_code', toIso2(get('t_entity.incorporation_country_code'))),
    ...directors.map((i) => directorNode(get, i)),
  ];
}

/** Subject as goAML: { kind: 'person'|'entity', children }. */
function subject(get, isOrg) {
  return isOrg ? { kind: 'entity', children: entityNode(get) } : { kind: 'person', children: personNode(get, 't_person') };
}

function transactionNode(get, i, ctx) {
  const g = (k) => get(`transaction[${i}].${k}`);
  const issues = [];
  const inbound = g('direction') === 'inbound';
  const cash = isCash({ category: g('category') });
  const transmode = cash ? (ctx.lookups.transmode?.cash || 'CASH') : (ctx.lookups.transmode?.[g('transmode_code')] || TRANSMODE[g('transmode_code')] || 'OTHER');
  const funds = ctx.lookups.funds?.[cash ? 'cash' : g('transmode_code')] || transmode;

  // amount_local must be in the report's local currency.
  const curr = s(g('currency_code')).toUpperCase();
  let amountLocal = '';
  let foreign = null;
  if (curr && curr === ctx.local) amountLocal = goamlAmount(g('amount_local'));
  else if (ctx.reporting === ctx.local && g('amount_reporting')) {
    amountLocal = goamlAmount(g('amount_reporting'));
    const orig = Number(g('amount_local'));
    const rate = orig ? Number(g('amount_reporting')) / orig : 0;
    foreign = [node('foreign_currency_code', curr), node('foreign_amount', goamlAmount(g('amount_local'))), node('foreign_exchange_rate', rate ? Math.abs(rate).toFixed(6) : '')];
  } else issues.push(`Transaction ${i + 1}: no amount in the local currency ${ctx.local} (${g('amount_local')} ${curr}; no exchange rate stored).`);

  const cpName = inbound ? g('from_party') : g('to_party');
  const cpAccount = inbound ? g('from_account') : g('to_account');
  const ownAccount = inbound ? g('to_account') : g('from_account');
  const cpCountry = toIso2(g('counterparty_country'));
  const side = (dir) => (dir === 'from' ? 'from' : 'to');

  // Our client: account (with the subject as owner / signatory) or the subject directly.
  const mine = (dir) => {
    const p = side(dir);
    const owner = ctx.subject.kind === 'entity'
      ? node('t_entity', ctx.subject.children)
      : node('signatory', [node('is_primary', 'true'), node('t_person', ctx.subject.children)]);
    const party = ownAccount
      ? node(`${p}_account`, [node('institution_name', ctx.institution), node('account', ownAccount), node('currency_code', curr), owner])
      : node(`${p}_${ctx.subject.kind}`, ctx.subject.children);
    return [node(`${p}_funds_code`, funds), foreign && p === 'from' ? node('from_foreign_currency', foreign) : null, foreign && p === 'to' ? node('to_foreign_currency', foreign) : null, party, node(`${p}_country`, ctx.country)];
  };
  // Counterparty: account when known, else an entity with the counterparty name.
  const theirs = (dir) => {
    const p = side(dir);
    const party = cpAccount
      ? node(`${p}_account`, [node('account', cpAccount), node('account_name', cpName)])
      : node(`${p}_entity`, [node('name', cpName || 'Unknown counterparty'), node('incorporation_country_code', cpCountry)]);
    if (!cpAccount) issues.push(`Transaction ${i + 1}: counterparty account not known.`);
    return [node(`${p}_funds_code`, funds), party, node(`${p}_country`, cpCountry)];
  };

  const children = [
    node('transactionnumber', `${ctx.ref}-${String(i + 1).padStart(3, '0')}`),
    node('internal_ref_number', g('internal_ref_number')),
    node('transaction_location', ctx.locationText),
    node('transaction_description', g('description') || `${inbound ? 'Incoming' : 'Outgoing'} ${transmode.toLowerCase()}`),
    node('date_transaction', goamlDate(g('date_transaction'))),
    node('transmode_code', transmode),
    node('amount_local', amountLocal),
    inbound ? node('t_from', theirs('from')) : node('t_from_my_client', mine('from')),
    inbound ? node('t_to_my_client', mine('to')) : node('t_to', theirs('to')),
  ];
  return { node: node('transaction', children), issues };
}

/**
 * Returns { xml, issues, type, kind, transactions }.
 * issues: data the builder could not map (shown with the validation result; they block approval when they leave a required value empty).
 */
export function buildGoamlXml({ report, fiu, tenant, client, submittedAt }) {
  const get = fieldReader(report.fields);
  get.paths = (report.fields || []).map((f) => f.path);
  const type = normaliseType(report.type);
  const kind = FIU_TYPES[type].kind;
  const isOrg = client?.client_type === 'ORG';
  const local = s(get('report.currency_code_local') || fiu?.currency_code_local || tenant?.tm_reporting_currency).toUpperCase();
  const country = toIso2(get('location.country_code') || fiu?.country_code || fiu?.code);
  const lookups = fiu?.report_codes?.lookups || {};
  const subj = subject(get, isOrg);
  const issues = [];

  const txIdx = [...new Set((report.fields || []).map((f) => f.path.match(/^transaction\[(\d+)\]\./)?.[1]).filter((x) => x != null))].map(Number).sort((a, b) => a - b);
  const reason = s(report.narrative?.text) || get('report.reason');
  const locationText = [get('location.address'), get('location.city')].filter(Boolean).join(', ') || tenant?.name || '';

  const header = [
    node('rentity_id', get('report.rentity_id') || fiu?.rentity_id),
    node('rentity_branch', get('report.rentity_branch') || fiu?.rentity_branch),
    node('submission_code', get('report.submission_code') || fiu?.submission_code || 'E'),
    node('report_code', get('report.report_code') || report.goaml_report_code || reportCodeFor(fiu, type)),
    node('entity_reference', report.report_ref),
    node('fiu_ref_number', report.received?.fiu_reference),
    node('submission_date', goamlDate(submittedAt || report.approved_at || new Date().toISOString())),
    node('currency_code_local', local),
    node('reporting_person', [
      node('title', get('reporting_person.title')), node('first_name', get('reporting_person.first_name')), node('last_name', get('reporting_person.last_name')),
      get('reporting_person.phone') ? node('phones', [node('phone', [node('tph_contact_type', 'BU'), node('tph_communication_type', 'L'), node('tph_number', get('reporting_person.phone'))])]) : null,
      node('email', get('reporting_person.email')), node('occupation', get('reporting_person.occupation')),
    ]),
    node('location', [
      node('address_type', get('location.address_type') || 'B'), node('address', get('location.address')), node('city', get('location.city')),
      node('zip', get('location.zip')), node('country_code', country),
    ]),
    node('reason', reason),
    node('action', type === 'TFR' ? 'Reported without delay. Asset freeze to be assessed under the applicable sanctions regulation. Customer not informed.' : ''),
  ];

  let body = [];
  if (kind === 'transaction') {
    const ctx = { ref: report.report_ref, local, reporting: s(tenant?.tm_reporting_currency).toUpperCase(), country, lookups, subject: subj, institution: tenant?.name || '', locationText };
    for (const i of txIdx) {
      const t = transactionNode(get, i, ctx);
      body.push(t.node);
      issues.push(...t.issues);
    }
  } else {
    const txSummary = txIdx.slice(0, 50).map((i) => `${get(`transaction[${i}].date_transaction`)} ${get(`transaction[${i}].direction`)} ${get(`transaction[${i}].amount_local`)} ${get(`transaction[${i}].currency_code`)} ${get(`transaction[${i}].direction`) === 'inbound' ? get(`transaction[${i}].from_party`) : get(`transaction[${i}].to_party`)}`.trim());
    body = [node('activity', [node('report_parties', [node('report_party', [
      node(subj.kind, subj.children),
      node('reason', reason.slice(0, 4000)),
      node('comments', txSummary.length ? `Related transactions: ${txSummary.join('; ')}` : ''),
    ])])])];
  }
  const indicators = (report.indicators || []).filter(Boolean);
  const footer = [node('report_indicators', indicators.map((c) => node('indicator', c)))];

  const inner = [...header, ...body, ...footer].map((n) => render(n, 1)).filter(Boolean).join('\n');
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<report>\n${inner}\n</report>\n`;
  return { xml, issues, type, kind, transactions: kind === 'transaction' ? txIdx.length : 0 };
}
