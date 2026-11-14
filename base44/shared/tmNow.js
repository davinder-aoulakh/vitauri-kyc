// Test clock for the TM pipeline. Pure: no I/O.
// The acceptance tests assume "today" is a fixed date (3 Nov 2026 for the sample MT940). A caller may pass `as_of`,
// but it is honoured only for a tenant with status Demo or for a Vitauri Ops caller. Everyone else gets the real time,
// so a production tenant can never be made to treat old transactions as recent (or the other way round).

const OPS_ROLE = 'Vitauri Ops';

/** True when this tenant / caller may set the clock. */
export function mayOverrideNow(tenant, caller) {
  return tenant?.status === 'Demo' || caller?.role === OPS_ROLE;
}

/** Parses as_of ("2026-11-03" or a full ISO timestamp). A bare date means the end of that day, UTC. Null when invalid. */
export function parseAsOf(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  const s = value.trim();
  const iso = /^\d{4}-\d{2}-\d{2}$/.test(s) ? `${s}T23:59:59.999Z` : s;
  if (!/^\d{4}-\d{2}-\d{2}T/.test(iso)) return null;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? new Date(t) : null;
}

/**
 * The time the pipeline should treat as "now".
 * tenant: the Tenant record; body: the request payload (may hold as_of); caller: { role } of the authenticated user.
 * realNow is injectable for tests.
 */
export function nowFor(tenant, body, caller, realNow = () => new Date()) {
  const asOf = mayOverrideNow(tenant, caller) ? parseAsOf(body?.as_of) : null;
  return asOf || realNow();
}

/** Whole days between an execution date ("YYYY-MM-DD" or ISO) and `now`; null when the date is unreadable. */
export function ageInDays(executedAt, now) {
  const t = Date.parse(/^\d{4}-\d{2}-\d{2}$/.test(String(executedAt)) ? `${executedAt}T00:00:00Z` : String(executedAt));
  if (!Number.isFinite(t)) return null;
  return Math.floor((now.getTime() - t) / 86400000);
}
