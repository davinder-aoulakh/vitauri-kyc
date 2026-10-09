import { createClientFromRequest } from 'npm:@base44/sdk@0.8.52';

const ADMIN_ROLES = ['Vitauri Ops', 'Tenant Admin'];

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json();
    const { action } = body;
    const role = user.app_role || user.data?.app_role;
    const isOps = role === 'Vitauri Ops';
    const tenantId = (isOps && body.tenant_id) ? body.tenant_id : (user.tenant_id || user.data?.tenant_id);
    if (!tenantId) return Response.json({ error: 'No tenant resolved' }, { status: 403 });

    const tenants = await base44.asServiceRole.entities.Tenant.filter({ id: tenantId });
    const tenant = tenants?.[0];
    if (!tenant) return Response.json({ error: 'Tenant not found' }, { status: 404 });

    const requireAdmin = () => ADMIN_ROLES.includes(role);
    const forbidden = () => Response.json({ error: 'Forbidden' }, { status: 403 });

    const audit = (eventType: string, before: unknown, after: unknown, notes: string) =>
      base44.asServiceRole.entities.AuditEvent.create({
        tenant_id: tenantId,
        actor_user_id: user.id,
        actor_name: user.full_name || user.email,
        actor_type: 'User',
        event_type: eventType,
        before_state: before,
        after_state: after,
        notes,
      });

    if (action === 'session_pdf') {
      const { session_id } = body;
      if (!session_id) return Response.json({ error: 'session_id is required' }, { status: 400 });
      const apiKey = tenant.didit_api_key?.trim();
      if (!apiKey) return Response.json({ error: 'Didit not configured for this tenant' });

      const urlsToTry = [
        `https://verification.didit.me/v3/session/${session_id}/generate-pdf/`,
        `https://verification.didit.me/v3/session/${session_id}/generate-pdf`,
        `https://verification.didit.me/v2/session/${session_id}/generate-pdf/`,
        `https://verification.didit.me/v1/session/${session_id}/generate-pdf/`,
      ];
      let pdfResp: Response | null = null;
      for (const url of urlsToTry) {
        const resp = await fetch(url, { method: 'GET', headers: { 'x-api-key': apiKey }, signal: AbortSignal.timeout(30000) });
        if (resp.ok) { pdfResp = resp; break; }
        const errBody = await resp.text().catch(() => '');
        if (resp.status === 401 || resp.status === 403) {
          return Response.json({ error: `PDF auth failed (${resp.status}): ${errBody || 'check API key'}` });
        }
      }
      if (!pdfResp) return Response.json({ error: `PDF generation failed: 404 on all endpoint variants. Session ID: ${session_id}.` });

      const bytes = new Uint8Array(await pdfResp.arrayBuffer());
      let binary = '';
      for (let i = 0; i < bytes.length; i += 8192) {
        binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
      }
      return Response.json({ pdf_base64: btoa(binary), content_type: pdfResp.headers.get('content-type') || 'application/pdf' });
    }

    if (action === 'credential_status') {
      if (!requireAdmin()) return forbidden();
      const key = tenant.didit_api_key || '';
      return Response.json({
        api_key_configured: !!key,
        api_key_last4: key ? key.slice(-4) : null,
        webhook_secret_configured: !!tenant.didit_webhook_secret,
        workflow_id: tenant.didit_workflow_id || null,
        app_id: tenant.didit_app_id || null,
      });
    }

    if (action === 'save_credentials') {
      if (!requireAdmin()) return forbidden();
      const fields = ['didit_api_key', 'didit_workflow_id', 'didit_workflows', 'didit_app_id', 'didit_min_match_score'];
      const update: Record<string, unknown> = {};
      for (const f of fields) {
        if (body[f] !== undefined && body[f] !== null && !(f === 'didit_api_key' && body[f] === '')) update[f] = body[f];
      }
      const wasConfigured = !!tenant.didit_api_key;
      if (Object.keys(update).length > 0) {
        await base44.asServiceRole.entities.Tenant.update(tenantId, update);
      }
      const configured = update.didit_api_key ? true : wasConfigured;
      const changed = Object.keys(update).map(k => k === 'didit_api_key' ? 'api_key' : k);
      await audit(
        'didit_credentials_updated',
        { api_key_configured: wasConfigured },
        { api_key_configured: configured },
        `Didit configuration updated. Fields changed: ${changed.join(', ') || 'none'}`,
      );
      return Response.json({ saved: true, api_key_configured: configured });
    }

    if (action === 'save_webhook_secret') {
      if (!requireAdmin()) return forbidden();
      if (!body.didit_webhook_secret) return Response.json({ error: 'didit_webhook_secret is required' }, { status: 400 });
      const before = !!tenant.didit_webhook_secret;
      await base44.asServiceRole.entities.Tenant.update(tenantId, { didit_webhook_secret: body.didit_webhook_secret });
      await audit(
        'didit_webhook_secret_updated',
        { secret_configured: before },
        { secret_configured: true },
        'Didit webhook secret updated',
      );
      return Response.json({ secret_configured: true });
    }

    return Response.json({ error: 'Unknown action' }, { status: 400 });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});