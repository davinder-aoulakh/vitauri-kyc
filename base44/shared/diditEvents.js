// Didit event-monitoring envelope (POST /v3/events/batch/). Field names per docs.didit.me transaction-monitoring/events.
import { sha256Hex } from './tmCanonical.js';

export const EVENT_CATEGORIES = ['auth', 'session', 'gameplay', 'bonus', 'affiliate', 'payment', 'dispute', 'security', 'responsible_gambling', 'custom'];
export const MAX_BATCH = 500;
const PAST_MS = 7 * 24 * 3600 * 1000;
const FUTURE_MS = 5 * 60 * 1000;

/**
 * Build one Didit event from a caller event and the server-resolved client.
 * Returns { event } or { error }. event_id: caller's own id (prefixed with the tenant) or a content hash — stable across retries.
 */
export async function buildEvent(tenantId, client, e, nowMs = Date.now()) {
  const category = String(e?.event_category || '');
  if (!EVENT_CATEGORIES.includes(category)) return { error: `invalid event_category '${category}'` };
  const action = String(e?.action_type || '').trim();
  if (!action || action.length > 100) return { error: 'action_type is required (max 100 chars)' };
  const at = Date.parse(e?.occurred_at || '');
  if (!Number.isFinite(at)) return { error: 'occurred_at must be an ISO date-time' };
  if (at < nowMs - PAST_MS || at > nowMs + FUTURE_MS) return { error: 'occurred_at must be within the last 7 days and at most 5 minutes ahead' };

  const core = {
    event_category: category,
    action_type: action,
    occurred_at: new Date(at).toISOString(),
    subject: { vendor_data: client.id, entity_type: client.client_type === 'ORG' ? 'company' : 'individual' },
    ...(e.payload && typeof e.payload === 'object' ? { payload: e.payload } : {}),
    ...(e.custom_values && typeof e.custom_values === 'object' ? { custom_values: e.custom_values } : {}),
  };
  const callerId = e?.event_id ? String(e.event_id).slice(0, 200) : null;
  const event_id = callerId
    ? `vt_${tenantId}_${callerId}`.slice(0, 255)
    : `vt_${(await sha256Hex(JSON.stringify([tenantId, core]))).slice(0, 48)}`;
  return { event: { event_id, ...core } };
}
