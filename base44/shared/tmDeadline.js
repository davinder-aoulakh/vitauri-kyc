// Deadline helpers for TmAlerts / TmCases (wraps tmClock).
import { computeDue } from './tmClock.js';
import { asList } from './tmAuth.js';

export const OPEN_ALERT = ['new', 'triaged', 'in_review'];
export const OPEN_CASE = ['open', 'investigating', 'pending_co'];

/** Tenant FIU profile (tm_settings.fiu_profile_code, default CW). Null when none is configured. */
export async function loadFiuProfile(E, tenant) {
  const code = tenant.tm_settings?.fiu_profile_code || 'CW';
  return asList(await E.FiuProfile.filter({ tenant_id: tenant.id, code }))[0] || null;
}

export function alertClock(fiu, alert) {
  const c = computeDue(fiu, {
    indicator_type: alert.indicator_type || 'subjective',
    executed_at: alert.executed_at,
    discovered_at: alert.discovered_at || alert.received_at || alert.created_date,
  });
  const arrived = alert.received_at || alert.created_date;
  const onArrival = !!(c.due_at && arrived && new Date(arrived).getTime() > new Date(c.due_at).getTime());
  return { due_at: c.due_at, phase: c.phase, expired_on_arrival: onArrival };
}

export function caseClock(fiu, tmCase, indicatorType = 'subjective') {
  const c = computeDue(fiu, {
    indicator_type: indicatorType,
    discovered_at: tmCase.created_date,
    escalated_at: tmCase.escalated_to_co_at,
    decided_at: tmCase.co_decided_at,
  });
  return { due_at: c.due_at, phase: c.phase };
}