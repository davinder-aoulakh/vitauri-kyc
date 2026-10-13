// Helpers for the TM investigation case workspace (/tm/case/:id).
export const HOUR = 3600000;

export const EVIDENCE_MARK = {
  risk: { symbol: '!', label: 'Risk', cls: 'bg-red-100 text-red-700' },
  ok: { symbol: '✓', label: 'OK', cls: 'bg-emerald-100 text-emerald-700' },
  unclear: { symbol: '?', label: 'Unclear', cls: 'bg-amber-100 text-amber-700' },
  gap: { symbol: '–', label: 'Data gap', cls: 'bg-slate-200 text-slate-600' },
};

export const CASE_STATUS_LABEL = {
  open: 'Open',
  investigating: 'Investigating',
  pending_co: 'Pending CO decision',
  decided_report: 'Decided: report',
  decided_no_report: 'Decided: no report',
  closed: 'Closed',
};

export const DECISION_CONFIG = {
  kyc_approval: { label: 'KYC decision', outcomes: [['approved', 'Approve KYC file'], ['rejected', 'Reject'], ['needs_more_info', 'More information needed']] },
  aml_assessment: { label: 'AML assessment', outcomes: [['no_concern', 'No AML concern'], ['concern_noted', 'Concern noted, keep monitoring'], ['refer_to_co', 'Refer to Compliance Officer']] },
  payment_release: { label: 'Payment release', outcomes: [['release', 'Release payment'], ['hold', 'Hold payment'], ['reject', 'Reject payment']] },
  report_decision: { label: 'CO decision', outcomes: [['report', 'Report to FIU'], ['no_report', 'Do not report']] },
};

export const OUTCOME_LABEL = Object.fromEntries(
  Object.values(DECISION_CONFIG).flatMap((c) => c.outcomes),
);

function workingDaysLeft(dueIso, now) {
  let n = 0;
  const d = new Date(now);
  const end = new Date(dueIso).getTime();
  while (true) {
    d.setUTCDate(d.getUTCDate() + 1);
    if (d.getTime() > end) break;
    if (d.getUTCDay() !== 0 && d.getUTCDay() !== 6) n++;
  }
  return n;
}

const PHASE_LABEL = { escalate: 'Escalation to CO window', investigate: 'CO investigation window', report: 'Report filing window' };

/** Pill shown in the case header: the active clock and what is left. Null when no clock runs. */
export function clockPill(tmCase, indicatorType, now = Date.now()) {
  if (!tmCase || ['decided_no_report', 'closed'].includes(tmCase.status) || !tmCase.due_at) return null;
  const phase = tmCase.phase || (tmCase.status === 'decided_report' ? 'report' : tmCase.status === 'pending_co' ? 'investigate' : 'escalate');
  const prefix = indicatorType === 'objective' ? 'Objective report' : 'Subjective report';
  const ms = new Date(tmCase.due_at).getTime() - now;
  let left;
  if (ms < 0) left = 'deadline passed';
  else if (phase === 'investigate') { const d = workingDaysLeft(tmCase.due_at, now); left = `${d} working day${d === 1 ? '' : 's'} left`; }
  else if (ms < 48 * HOUR) left = `${Math.max(1, Math.floor(ms / HOUR))} h left`;
  else left = `${Math.floor(ms / (24 * HOUR))} days left`;
  return { text: `${prefix}: ${PHASE_LABEL[phase] || phase} · ${left}`, overdue: ms < 0 };
}

export const alertShortId = (id) => `AL-${String(id || '').slice(-4).toUpperCase()}`;