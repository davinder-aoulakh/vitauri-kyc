// ingestDiditEvents — server lane for Didit event monitoring (POST /v3/events/batch/).
// Auth: tenant API key with scope tm:token. Body: { events: [{ client_id | external_id, event_id?, event_category,
//   action_type, occurred_at, payload?, custom_values? }] } (max 500).
// subject.vendor_data is resolved server-side from the tenant's client. event_id is stable across retries, so a
// resend is an idempotent replay at Didit. Didit errors are surfaced separately: 400 invalid, 401/403 auth or
// event monitoring disabled, 409 event_id reused with different content, 429 rate limited.
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.52';
import { errorResponse, httpError } from '../../shared/tmAuth.js';
import { writeAudit } from '../../shared/tmAudit.js';
import { postEventsBatch } from '../../shared/diditTm.js';
import { authenticateDeviceLane, resolveClient } from '../../shared/diditDeviceLane.js';
import { buildEvent, MAX_BATCH } from '../../shared/diditEvents.js';

export default async function (req) {
  try {
    const base44 = createClientFromRequest(req);
    const body = await req.json().catch(() => ({}));
    const { auth, tenant } = await authenticateDeviceLane(base44, req, body);
    const input = Array.isArray(body.events) ? body.events : null;
    if (!input || input.length === 0) throw httpError(400, 'events must be a non-empty array');
    if (input.length > MAX_BATCH) throw httpError(400, `At most ${MAX_BATCH} events per call`);

    // Validate and resolve every event; invalid ones are reported by index and not sent.
    const clients = new Map();
    const rejected = [];
    const toSend = [];
    const indexMap = [];
    const now = Date.now();
    for (let i = 0; i < input.length; i++) {
      const e = input[i] || {};
      const key = e.client_id ? `id:${e.client_id}` : e.external_id ? `ext:${e.external_id}` : null;
      if (!key) { rejected.push({ index: i, error: 'client_id or external_id is required' }); continue; }
      if (!clients.has(key)) {
        clients.set(key, await resolveClient(base44, auth.tenantId, { client_id: e.client_id, external_id: e.client_id ? undefined : e.external_id }).catch(() => null));
      }
      const client = clients.get(key);
      if (!client) { rejected.push({ index: i, error: 'client not found' }); continue; }
      const built = await buildEvent(auth.tenantId, client, e, now);
      if (built.error) { rejected.push({ index: i, error: built.error }); continue; }
      toSend.push(built.event);
      indexMap.push(i);
    }
    if (toSend.length === 0) return Response.json({ accepted: 0, rejected }, { status: 400 });

    let res;
    try {
      res = await postEventsBatch(tenant, toSend);
    } catch (e) {
      const detail = JSON.stringify(e?.detail || '');
      if (e?.status === 400) return Response.json({ error: 'didit_rejected_batch', detail: e.detail, rejected }, { status: 400 });
      if (e?.status === 403 && detail.includes('event_monitoring_disabled')) {
        return Response.json({ error: 'event_monitoring_disabled', detail: 'Event monitoring is not enabled for this Didit application' }, { status: 409 });
      }
      if (e?.status === 401 || e?.status === 403) return Response.json({ error: 'didit_auth_failed' }, { status: 502 });
      if (e?.status === 409) return Response.json({ error: 'event_id_conflict', detail: 'An event_id was already sent with different content', rejected }, { status: 409 });
      if (e?.status === 429) return Response.json({ error: 'rate_limited', detail: 'Retry later with the same event_ids' }, { status: 429 });
      throw httpError(502, `Didit events request failed${e?.status ? ` (HTTP ${e.status})` : ''}`);
    }

    // 201 → all accepted; 207 → per-index results (indexes refer to the batch we sent; map back to the caller's).
    const results = Array.isArray(res?.results)
      ? res.results.map((r, j) => ({ ...r, index: indexMap[r?.index ?? j] ?? r?.index }))
      : null;
    const failed = results ? results.filter((r) => r?.status && !['created', 'accepted', 'idempotent_replay', 'ok'].includes(String(r.status).toLowerCase())).length : 0;

    await writeAudit(base44, auth, {
      tenantId: auth.tenantId, eventType: 'tm_didit_events_ingested',
      after: { sent: toSend.length, rejected_locally: rejected.length, didit_failed: failed },
      notes: `Didit events: ${toSend.length} sent, ${rejected.length} rejected locally.`,
    }).catch(() => {});

    return Response.json({
      accepted: toSend.length - failed, sent: toSend.length, rejected,
      ...(results ? { results } : {}),
      event_ids: toSend.map((ev, j) => ({ index: indexMap[j], event_id: ev.event_id })),
    }, { status: results || rejected.length ? 207 : 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
