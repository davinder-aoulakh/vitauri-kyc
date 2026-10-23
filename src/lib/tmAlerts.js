// Helpers for the TM alert queue (/tm/alerts).
export const HOUR = 3600000;
export const OPEN_STATUSES = ['new', 'triaged', 'in_review', 'escalated'];
export const CLOSABLE_STATUSES = ['new', 'triaged', 'in_review'];

export const FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'mine', label: 'Assigned to me' },
  { key: 'soon', label: 'Deadline < 24 h' },
  { key: 'expired', label: 'Deadline expired' },
  { key: 'ai_close', label: 'AI: close suggested' },
];

export const PROPOSAL_LABEL = {
  escalate: 'Escalate',
  close: 'Close suggested',
  request_info: 'Request info',
  insufficient_evidence: 'Insufficient evidence',
};

/** Readable alert reference: the stored ref (AL-2026-0412) when present, else a short id. Accepts an alert or an id. */
export const shortId = (a) => (a && typeof a === 'object' ? a.ref : null) || `AL-${String((a && typeof a === 'object' ? a.id : a) || '').slice(-4).toUpperCase()}`;

/** Server-side query for a filter pill. */
export function buildAlertQuery(filter, tenantId, userId, now = Date.now()) {
  const q = { tenant_id: tenantId, status: { $in: OPEN_STATUSES } };
  if (filter === 'mine') q.assigned_to_user_id = userId;
  if (filter === 'soon') q.due_at = { $gte: new Date(now).toISOString(), $lt: new Date(now + 24 * HOUR).toISOString() };
  if (filter === 'expired') q.due_at = { $lt: new Date(now).toISOString() };
  if (filter === 'ai_close') q.ai_proposal = 'close';
  return q;
}

export function deadlineState(alert, now = Date.now()) {
  if (!alert?.due_at) return { kind: 'none', ms: 0 };
  const ms = new Date(alert.due_at).getTime() - now;
  if (ms < 0) return { kind: 'expired', ms };
  return { kind: ms < 24 * HOUR ? 'soon' : 'ok', ms };
}

export function formatCountdown(ms) {
  const abs = Math.abs(ms);
  const d = Math.floor(abs / (24 * HOUR));
  const h = Math.floor((abs % (24 * HOUR)) / HOUR);
  const m = Math.floor((abs % HOUR) / 60000);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

export function errorMessage(err) {
  return err?.response?.data?.error || err?.data?.error || err?.message || 'Something went wrong';
}

/** Highest score first, then earliest deadline. */
export function sortAlerts(list) {
  return [...list].sort((a, b) => (b.score || 0) - (a.score || 0)
    || (a.due_at ? new Date(a.due_at).getTime() : Infinity) - (b.due_at ? new Date(b.due_at).getTime() : Infinity));
}