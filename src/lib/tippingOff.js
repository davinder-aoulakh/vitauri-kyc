// Tipping-off lock helpers for the UI.
import { base44 } from '@/api/base44Client';

export const LOCK_BANNER = 'Customer communications locked — FIU report in progress (no tipping-off)';

/** Quick display hint only (Client mirror). Never use it to authorise a send. */
export const isLocked = (client) => !!client?.tipping_off_lock;

/** Authoritative server check right before a send: reads the TippingOffLock rows. */
export async function fetchLocked(tenantId, clientId) {
  const page = await base44.entities.TippingOffLock.filter({ tenant_id: tenantId, client_id: clientId, locked: true }, { limit: 1 });
  return (page?.items || []).length > 0;
}