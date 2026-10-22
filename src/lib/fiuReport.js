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
  ['executed_at', 'Executed'], ['received_at', 'Received by Vitauri'], ['discovered_at', 'Discovered'],
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