// mintDiditTransactionToken — short-lived Didit transaction SDK token for one of the tenant's clients.
// Auth: tenant API key with scope tm:token. Body: { client_id | external_id, ttl_seconds?, max_uses? }.
// Returns only { sdk_token, expires_at }. vendor_data is the Vitauri client id, resolved server-side.
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.52';
import { errorResponse, httpError } from '../../shared/tmAuth.js';
import { writeAudit } from '../../shared/tmAudit.js';
import { mintTransactionToken } from '../../shared/diditTm.js';
import { authenticateDeviceLane, resolveClient, clampTtl, clampUses } from '../../shared/diditDeviceLane.js';

export default async function (req) {
  try {
    const base44 = createClientFromRequest(req);
    const body = await req.json().catch(() => ({}));
    const { auth, tenant } = await authenticateDeviceLane(base44, req, body);
    const client = await resolveClient(base44, auth.tenantId, body);

    let res;
    try {
      res = await mintTransactionToken(tenant, { vendor_data: client.id, ttl_seconds: clampTtl(body.ttl_seconds), max_uses: clampUses(body.max_uses) });
    } catch (e) {
      throw httpError(e?.status === 429 ? 429 : 502, `Didit token request failed${e?.status ? ` (HTTP ${e.status})` : ''}`);
    }
    if (!res?.sdk_token) throw httpError(502, 'Didit returned no token');

    await writeAudit(base44, auth, {
      tenantId: auth.tenantId, clientId: client.id, eventType: 'tm_didit_transaction_token_minted',
      after: { expires_at: res.expires_at || null }, notes: 'Didit transaction SDK token issued.',
    }).catch(() => {});
    return Response.json({ sdk_token: res.sdk_token, expires_at: res.expires_at || null });
  } catch (error) {
    return errorResponse(error);
  }
}
