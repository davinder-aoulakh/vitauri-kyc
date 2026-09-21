/**
 * Registers (or updates) the Didit webhook destination for a tenant, and
 * optionally sends a signed test event through it.
 *
 * action: 'register' (default) — POST /v3/webhook/destinations/, falls back to
 *         PATCH if the URL is already registered (400). Stores secret_shared_key
 *         on the Tenant as didit_webhook_secret.
 * action: 'test' — sends a real signed test event to our own webhook endpoint
 *         using the stored secret, to confirm the end-to-end pipeline works.
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';
import { computeDiditSignature } from '../../shared/diditWebhookVerify.js';

const WEBHOOK_URL = 'https://vitauri-kyc.base44.app/functions/diditWebhook';

export default async function(req) {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const { tenant_id, action = 'register' } = await req.json();
    if (!tenant_id) return Response.json({ error: 'tenant_id is required' });

    const tenants = await base44.asServiceRole.entities.Tenant.filter({ id: tenant_id });
    const tenant  = tenants?.[0];
    if (!tenant?.didit_api_key) return Response.json({ error: 'Didit API key not configured for this tenant' });

    if (action === 'test') {
      if (!tenant.didit_webhook_secret) {
        return Response.json({ error: 'No webhook secret configured yet — register the webhook first.' });
      }
      const testPayload = {
        event_id:     `test-${Date.now()}`,
        webhook_type: 'status.updated',
        timestamp:    Math.floor(Date.now() / 1000),
        session_id:   'test-session',
        status:       'Not Started',
        vendor_data:  'test-client',
        metadata:     { tenant_id, test: true },
      };
      const raw = JSON.stringify(testPayload);
      const sig = await computeDiditSignature(raw, tenant.didit_webhook_secret);

      const resp = await fetch(WEBHOOK_URL, {
        method:  'POST',
        headers: {
          'Content-Type':   'application/json',
          'x-signature-v2': sig,
          'x-timestamp':    String(testPayload.timestamp),
        },
        body: raw,
      });
      const result = await resp.json().catch(() => ({}));
      return Response.json({ ok: resp.ok, status: resp.status, result });
    }

    // ── action: register ────────────────────────────────────────────────────
    const body = {
      label:              `${tenant.name || tenant.slug} — Vitauri KYC`,
      url:                WEBHOOK_URL,
      webhook_version:    'v3',
      subscribed_events:  ['status.updated', 'data.updated', 'user.status.updated'],
    };

    let resp = await fetch('https://verification.didit.me/v3/webhook/destinations/', {
      method:  'POST',
      headers: { 'x-api-key': tenant.didit_api_key, 'Content-Type': 'application/json' },
      body:    JSON.stringify(body),
    });

    // Destination already exists for this (application, url) pair — PATCH it instead.
    if (resp.status === 400) {
      const listResp = await fetch('https://verification.didit.me/v3/webhook/destinations/', {
        headers: { 'x-api-key': tenant.didit_api_key },
      });
      if (listResp.ok) {
        const list = await listResp.json();
        const destinations = Array.isArray(list) ? list : (list?.results || []);
        const existing = destinations.find((d) => d.url === WEBHOOK_URL);
        if (existing?.uuid) {
          const patchResp = await fetch(`https://verification.didit.me/v3/webhook/destinations/${existing.uuid}/`, {
            method:  'PATCH',
            headers: { 'x-api-key': tenant.didit_api_key, 'Content-Type': 'application/json' },
            body:    JSON.stringify({ webhook_version: 'v3', subscribed_events: body.subscribed_events }),
          });
          if (patchResp.ok) {
            return Response.json({
              ok: true, updated: true, webhook_url: WEBHOOK_URL,
              secret_configured: !!tenant.didit_webhook_secret,
              note: 'Webhook destination already existed and was updated. Existing secret remains valid.',
            });
          }
          const patchErr = await patchResp.text().catch(() => '');
          return Response.json({ error: `Failed to update existing webhook destination (${patchResp.status}): ${patchErr}` });
        }
      }
    }

    if (!resp.ok) {
      const errBody = await resp.text().catch(() => '');
      return Response.json({ error: `Didit webhook registration failed (${resp.status}): ${errBody}` });
    }

    const data = await resp.json();
    const secret = data.secret_shared_key || data.secret;
    if (!secret) {
      return Response.json({ error: 'Didit did not return a webhook secret — check the console.' });
    }

    await base44.asServiceRole.entities.Tenant.update(tenant_id, { didit_webhook_secret: secret });

    return Response.json({ ok: true, webhook_url: WEBHOOK_URL, secret_configured: true });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}