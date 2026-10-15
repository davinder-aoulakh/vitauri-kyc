// Optional auto-triage of NEW TmAlerts (tm_settings.auto_triage_new_alerts). Never throws and never delays the caller:
// the triage call is handed to waitUntil. triageAlerts only proposes (new -> triaged), it never closes or escalates.
import { asList } from './tmAuth.js';

const flagOn = (tenant) => {
  let s = tenant?.tm_settings;
  if (typeof s === 'string') { try { s = JSON.parse(s); } catch { s = null; } }
  return s?.auto_triage_new_alerts === true;
};

/** Call only after a TmAlert was CREATED (not merged). `waitUntilFn` is the caller's waitUntil from base44:runtime. */
export async function scheduleAutoTriage(base44, { tenantId, tenant, alertId, waitUntilFn }) {
  try {
    if (!tenantId || !alertId) return false;
    const t = tenant || asList(await base44.asServiceRole.entities.Tenant.filter({ id: tenantId }))[0];
    if (!flagOn(t)) return false;
    const task = Promise.resolve()
      .then(() => base44.asServiceRole.functions.invoke('triageAlerts', { alert_ids: [alertId], tenant_id: tenantId }))
      .catch((e) => console.warn('auto-triage failed', e?.message || e));
    let wait = waitUntilFn;
    if (!wait) { try { wait = (await import('base44:runtime')).waitUntil; } catch { wait = null; } }
    if (wait) wait(task);
    return true;
  } catch (e) {
    console.warn('auto-triage not scheduled', e?.message || e);
    return false;
  }
}