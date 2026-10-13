// Tipping-off lock helpers for the UI.
import { base44 } from '@/api/base44Client';

export const LOCK_BANNER = 'Customer communications locked — FIU report in progress (no tipping-off)';

export const isLocked = (client) => !!client?.tipping_off_lock;

/** Fresh server check right before a send (the loaded client record may be stale). */
export async function fetchLocked(tenantId, clientId) {
  const page = await base44.entities.Client.filter({ tenant_id: tenantId, id: clientId }, { limit: 1 });
  return isLocked(page?.items?.[0]);
}