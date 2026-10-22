// mintDiditMonitoringToken — short-lived Didit event-monitoring token for one of the tenant's clients.
// Auth: tenant API key with scope tm:token. Body: { client_id | external_id, ttl_seconds?, max_uses?, allowed_event_categories? }.
// Returns only { monitoring_token, expires_at } (403 event_monitoring_disabled from Didit → 409).
// Returns only { monitoring_token, expires_at }. vendor_data is the Vitauri client id, resolved server-side.
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.52';
import { errorResponse, httpError } from '../../shared/tmAuth.js';
import { writeAudit } from '../../shared/tmAudit.js';
import { mintMonitoringToken } from '../../shared/diditTm.js';
import { authenticateDeviceLane, resolveClient, clampTtl, clampUses } from '../../shared/diditDeviceLane.js';
import { EVENT_CATEGORIES } from '../../shared/diditEvents.js';

export default async function (req) {
  try {
    const base44 = createClientFromRequest(req);
    const body = await req.json().catch(() => ({}));
    const { auth, tenant } = await authenticateDeviceLane(base44, req, body);
    const client = await resolveClient(base44, auth.tenantId, body);

    const cats = Array.isArray(body.allowed_event_categories) ? body.allowed_event_categories.map(String) : [];
    const bad = cats.filter((c) => !EVENT_CATEGORIES.includes(c));
    if (bad.length) throw httpError(400, `Unknown event categories: ${bad.join(', ')}`);

    let res;
    try {
      res = await mintMonitoringToken(tenant, {
        vendor_data: client.id, ttl_seconds: clampTtl(body.ttl_seconds), max_uses: clampUses(body.max_uses), allowed_event_categories: cats,
      });
    } catch (e) {
      const disabled = e?.status === 403 && JSON.stringify(e?.detail || '').includes('event_monitoring_disabled');
      if (disabled) throw httpError(409, 'Event monitoring is not enabled for this Didit application');
      throw httpError(e?.status === 429 ? 429 : 502, `Didit token request failed${e?.status ? ` (HTTP ${e.status})` : ''}`);
    }
    const token = res?.monitoring_token || res?.sdk_token || res?.token;
    if (!token) throw httpError(502, 'Didit returned no token');

    await writeAudit(base44, auth, {
      tenantId: auth.tenantId, clientId: client.id, eventType: 'tm_didit_monitoring_token_minted',
      after: { expires_at: res.expires_at || null, allowed_event_categories: cats }, notes: 'Didit event-monitoring token issued.',
    }).catch(() => {});
    return Response.json({ monitoring_token: token, expires_at: res.expires_at || null });
  } catch (error) {
    return errorResponse(error);
  }
}
