// FIU deadline clock for Transaction Monitoring.

const HOUR = 3600000;

export function addWorkingDays(dateISO, n, holidays = []) {
  const hol = new Set((holidays || []).map((h) => String(h).slice(0, 10)));
  const d = new Date(dateISO);
  let left = n;
  while (left > 0) {
    d.setUTCDate(d.getUTCDate() + 1);
    const dow = d.getUTCDay();
    if (dow === 0 || dow === 6) continue;
    if (hol.has(d.toISOString().slice(0, 10))) continue;
    left--;
  }
  return d.toISOString();
}

const plusHours = (iso, h) => new Date(new Date(iso).getTime() + h * HOUR).toISOString();

export function computeDue(fiuProfile, { indicator_type, executed_at, discovered_at, escalated_at, decided_at } = {}) {
  const p = fiuProfile || {};
  let due_at = null;
  let phase = 'escalate';
  let without_delay = false;

  if (p.report_without_delay) {
    without_delay = true;
    due_at = discovered_at ? plusHours(discovered_at, 24) : null;
    phase = decided_at ? 'report' : escalated_at ? 'investigate' : 'escalate';
  } else if (indicator_type === 'objective') {
    phase = 'report';
    if (executed_at) due_at = plusHours(executed_at, p.objective_deadline_hours ?? 0);
  } else if (decided_at) {
    phase = 'report';
    due_at = plusHours(decided_at, p.report_deadline_hours ?? 0);
  } else if (escalated_at) {
    phase = 'investigate';
    due_at = addWorkingDays(escalated_at, p.co_investigation_working_days ?? 0, p.holiday_calendar);
  } else if (discovered_at) {
    phase = 'escalate';
    due_at = plusHours(discovered_at, p.subjective_escalation_hours ?? 0);
  }

  const now = Date.now();
  const expired = due_at ? now > new Date(due_at).getTime() : false;
  // received_at is the current time (this is evaluated on arrival)
  return { due_at, phase, expired, expired_on_arrival: expired, without_delay };
}