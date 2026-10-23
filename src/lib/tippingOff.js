// Tipping-off lock helpers for the UI.
import { base44 } from '@/api/base44Client';
import { isFeatureEnabled } from '@/lib/featureFlags';

export const LOCK_BANNER = 'Customer communications locked — FIU report in progress (no tipping-off)';

/** Quick display hint only (Client mirror). Never use it to authorise a send. */
export const isLocked = (client) => !!client?.tipping_off_lock;

/** Authoritative server check right before a send: reads the TippingOffLock rows. */
export async function fetchLocked(tenantId, clientId) {
  const page = await base44.entities.TippingOffLock.filter({ tenant_id: tenantId, client_id: clientId, locked: true }, { limit: 1 });
  return (page?.items || []).length > 0;
}

/**
 * Sends a customer email. With tm_core on, it goes through the sendOutreachEmail function, which refuses (423) while
 * the customer is locked. With tm_core off, it keeps the original direct Core.SendEmail call.
 */
export async function sendCustomerEmail({ tenant, clientId, to, subject, body, caseId, outreachRequestId }) {
  if (isFeatureEnabled(tenant, 'tm_core')) {
    const res = await base44.functions.invoke('sendOutreachEmail', { client_id: clientId, to, subject, body, case_id: caseId, outreach_request_id: outreachRequestId });
    if (res?.data?.error) throw new Error(res.data.error);
    return res?.data;
  }
  return base44.integrations.Core.SendEmail({
    from_name: tenant?.email_from_name || tenant?.name || 'Compliance Team',
    ...(tenant?.email_from_address ? { from_email: tenant.email_from_address } : {}),
    to, subject, body,
  });
}

/** True when an error came from the server-side tipping-off lock. */
export const isLockError = (e) => e?.response?.status === 423 || /locked/i.test(e?.response?.data?.error || e?.message || '');