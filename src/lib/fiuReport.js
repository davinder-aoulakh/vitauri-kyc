// Helpers for the FIU report workspace (/tm/report/:id).
import { base44 } from '@/api/base44Client';

export const STATUS_RANK = { draft: 0, in_review: 1, approved: 2, generated: 3, submitted: 4, rejected: 4, received: 5, accepted: 6 };
export const STATUS_LABEL = {
  draft: 'Draft', in_review: 'In review', approved: 'Approved', generated: 'Generated',
  submitted: 'Submitted', received: 'Received', accepted: 'Accepted', rejected: 'Rejected by FIU',
};
export const SUBMISSION_METHODS = [
  { value: 'portal_upload', label: 'FIU portal upload' },
  { value: 'xml_upload', label: 'XML upload' },
  { value: 'm2m', label: 'Machine to machine' },
];

export const rank = (report) => STATUS_RANK[report?.status] ?? 0;

export const REPORT_TYPE_LABEL = {
  unusual_objective: 'Unusual transaction report · objective',
  unusual_subjective: 'Unusual transaction report · subjective',
};

// Readable labels for goAML paths (mandatory fields); anything else is humanised from the path.
const FIELD_LABEL = {
  'reporting_entity.id': 'Reporting entity ID',
  'report.type': 'Report type',
  'report.indicator': 'Indicator code',
  'report.reason': 'Reason for reporting',
  't_person.first_name': 'Subject first name',
  't_person.last_name': 'Subject last name',
  't_person.birthdate': 'Subject date of birth',
  't_person.nationality1': 'Subject nationality',
  't_person.identification.number': 'ID document number',
  't_person.addresses.address.address': 'Subject address',
  't_entity.name': 'Entity name',
  't_entity.incorporation_number': 'Registration number',
  't_from_my_client.from_account.account': 'Customer account number / IBAN',
  'transaction.date_transaction': 'Transaction date',
  'transaction.amount_local': 'Transaction amount (local currency)',
  'transaction.currency_code': 'Transaction currency',
};
const SEGMENT = { t_person: 'Subject', t_entity: 'Entity', t_from_my_client: 'From customer', t_to_my_client: 'To customer', reporting_entity: 'Reporting entity' };

export function fieldLabel(path) {
  const p = String(path || '');
  if (FIELD_LABEL[p]) return FIELD_LABEL[p];
  const parts = p.replace(/\[\d+\]/g, '').split('.');
  const head = SEGMENT[parts[0]] || parts[0].replace(/_/g, ' ');
  const tail = parts.slice(1).filter((x) => !['address', 'addresses', 'identification'].includes(x) || parts.length < 3).pop() || '';
  const text = `${head}${tail ? ` ${tail.replace(/_/g, ' ').replace(/\d+$/, '')}` : ''}`.trim();
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export function buildSteps(report) {
  const r = rank(report);
  const missing = (report.missing_fields || []).length;
  const filled = (report.fields || []).length;
  const raw = [
    { key: 'gathered', label: 'Gathered', done: true },
    { key: 'completed', label: `Completed (${filled} of ${filled + missing} fields)`, done: true },
    { key: 'review', label: missing && r < 2 ? `Review (${missing} field${missing > 1 ? 's' : ''} need input)` : 'Review', done: r >= 2 },
    { key: 'approved', label: 'Approved', done: r >= 2 },
    { key: 'generated', label: 'Generated', done: r >= 3 },
    { key: 'submitted', label: 'Submitted', done: r >= 4 },
    { key: 'received', label: 'Received', done: r >= 5 },
  ];
  let currentSet = false;
  return raw.map((s) => {
    if (s.done) return { ...s, state: 'done' };
    if (!currentSet) { currentSet = true; return { ...s, state: 'current' }; }
    return { ...s, state: 'todo' };
  });
}

export const TONE_CLASS = {
  teal: 'bg-teal-50 text-teal-700 border-teal-200',
  green: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  purple: 'bg-purple-50 text-purple-700 border-purple-200',
  sky: 'bg-sky-50 text-sky-700 border-sky-200',
  grey: 'bg-secondary text-muted-foreground border-border',
};

export function sourceTone(f) {
  if (f.by === 'user' || f.source === 'User') return 'sky';
  if (f.by === 'agent' || /narrative|\bAI\b/i.test(f.source || '')) return 'purple';
  if (/didit/i.test(f.source || '')) return 'green';
  if (/kyc/i.test(f.source || '')) return 'teal';
  return 'grey';
}

const HOUR = 3600000;
const CLOCK = [
  ['intended_at', 'Intended'], ['executed_at', 'Executed'], ['received_at', 'Received by Vitauri'], ['discovered_at', 'Discovered'],
  ['escalated_at', 'Escalated to CO'], ['decided_at', 'CO decision'],
];

/** Rows of the deadline clock with an annotation relative to the previous milestone. */
export function clockRows(report) {
  const clock = report.clock || {};
  let prev = null;
  return CLOCK.filter(([k]) => clock[k]).map(([k, label]) => {
    const t = new Date(clock[k]).getTime();
    let note = '';
    if (prev !== null) {
      const h = (t - prev) / HOUR;
      note = h < 0 ? '' : h <= 24 ? 'within 24 h' : h < 72 ? `${Math.round(h)} h later` : `${Math.round(h / 24)} d later`;
    }
    prev = t;
    return { key: k, label, at: clock[k], note };
  });
}

export function citationLink(ref, report) {
  const [kind] = String(ref).split(':');
  if (kind === 'alert') return '/tm/alerts';
  if (kind === 'evidence') return `/tm/case/${report.tm_case_id}`;
  return `/client/${report.client_id}?tab=overview`;
}

export function citationLabel(ref, report) {
  const [kind, id] = String(ref).split(':');
  if (kind === 'txn') {
    const t = (report.snapshot?.transactions || []).find((x) => x.id === id);
    return t ? `Transaction ${t.date} · ${t.amount} ${t.currency}${t.counterparty ? ` · ${t.counterparty}` : ''}` : 'Transaction';
  }
  return { alert: 'Alert', evidence: 'Case evidence', profile: 'Approved expected profile' }[kind] || ref;
}

export async function uploadEvidence(file) {
  const res = await base44.integrations.Core.UploadPrivateFile({ file });
  if (!res?.file_uri) throw new Error('Upload failed');
  return res.file_uri;
}