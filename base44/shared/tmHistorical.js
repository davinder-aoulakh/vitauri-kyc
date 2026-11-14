// Historical window (gap G2, spec 5.4): "analyse, don't alert". Pure: no I/O.
// A transaction executed more than `historical_window_days` calendar days before "now" is stored as historical:
// it feeds the ledger and the analysis, but is not sent to Didit and raises no alert. One tenant setting for every
// channel (upload, API, PSD2, manual); default 30 days.
import { ageInDays } from './tmNow.js';

export const DEFAULT_HISTORICAL_WINDOW_DAYS = 30;
const MAX_WINDOW_DAYS = 3650;

function settingsOf(tenant) {
  const s = tenant?.tm_settings;
  if (!s) return {};
  if (typeof s === 'string') { try { return JSON.parse(s) || {}; } catch { return {}; } }
  return typeof s === 'object' ? s : {};
}

/** The tenant's window in whole days; the default when the setting is missing or not a sensible number. */
export function historicalWindowDays(tenant) {
  const n = Number(settingsOf(tenant).historical_window_days);
  return Number.isInteger(n) && n >= 1 && n <= MAX_WINDOW_DAYS ? n : DEFAULT_HISTORICAL_WINDOW_DAYS;
}

/** True when the execution date (ISO timestamp or YYYY-MM-DD) lies more than `days` calendar days before `now` (UTC days). */
export function isHistorical(executedAt, now, days = DEFAULT_HISTORICAL_WINDOW_DAYS) {
  const day = executedAt instanceof Date ? executedAt.toISOString().slice(0, 10) : String(executedAt ?? '').slice(0, 10);
  const age = ageInDays(day, now);
  return age !== null && age > days;
}

/**
 * The historical flag to store. A value the caller gave explicitly is kept; an intended (not yet executed)
 * transaction is never historical; otherwise it follows the window.
 */
export function resolveHistorical({ historical, lifecycle, executedAt }, now, days) {
  if (typeof historical === 'boolean') return historical;
  if (lifecycle === 'intended') return false;
  return isHistorical(executedAt, now, days);
}

/** { historical, recent } for statement rows ({ date: 'YYYY-MM-DD', lifecycle }). */
export function countHistorical(rows, now, days) {
  let historical = 0;
  for (const r of rows || []) if (resolveHistorical({ lifecycle: r.lifecycle, executedAt: r.date }, now, days)) historical++;
  return { historical, recent: (rows || []).length - historical };
}
