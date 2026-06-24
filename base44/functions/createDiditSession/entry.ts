import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const params = await req.json();

    const {
      outreach_id, item_id, client_id, tenant_id,
      portal_url, language = 'en',
      client_email, first_name, last_name,
      idv_workflow_id,
      _test_only, api_key: testApiKey, workflow_id: testWorkflowId,
    } = params;

    // ── TEST MODE: just validate credentials ────────────────────────────────
    if (_test_only) {
      if (!testApiKey || !testWorkflowId) {
        return Response.json({ error: 'API key and workflow ID required' });
      }
      try {
        const r = await fetch('https://verification.didit.me/v3/workflows/', {
          headers: { 'x-api-key': testApiKey }
        });
        return Response.json(r.ok ? { ok: true } : { error: `Invalid credentials (${r.status})` });
      } catch (err) {
        return Response.json({ error: err.message });
      }
    }

    // ── PRODUCTION MODE ──────────────────────────────────────────────────────

    // 1. Load tenant credentials (service role — portal user is unauthenticated)
    const tenants = await base44.asServiceRole.entities.Tenant.filter({ id: tenant_id });
    const tenant  = tenants?.[0];
    if (!tenant?.didit_api_key) {
      return Response.json({
        error: 'Identity verification is not configured for this institution. Contact support.'
      });
    }

    // Priority 1: item-level workflow ID (set on the OutreachTemplate field)
    let resolvedWorkflowId = idv_workflow_id || '';

    // Priority 2: tenant default workflow from didit_workflows array
    if (!resolvedWorkflowId && tenant?.didit_workflows) {
      try {
        const workflows = JSON.parse(tenant.didit_workflows);
        const defaultWf = workflows.find(w => w.is_default) || workflows[0];
        if (defaultWf?.workflow_id) resolvedWorkflowId = defaultWf.workflow_id;
      } catch { /* invalid JSON — skip */ }
    }

    // Priority 3: legacy single workflow_id field
    if (!resolvedWorkflowId && tenant?.didit_workflow_id) {
      resolvedWorkflowId = tenant.didit_workflow_id;
    }

    if (!resolvedWorkflowId) {
      return Response.json({ error: 'No Didit workflow configured. Ask your administrator to configure workflows.' });
    }

    // 2. Build callback URL
    const callbackUrl = `${portal_url}?didit_done=1&outreach_id=${outreach_id}&item_id=${item_id}`;

    // 3. Build request body
    const body = {
      workflow_id:     resolvedWorkflowId,
      vendor_data:     client_id,
      callback:        callbackUrl,
      callback_method: 'both',
      language:        language || 'en',
      metadata: {
        outreach_id,
        item_id,
        tenant_id,
        workflow_used: resolvedWorkflowId,
        platform: 'vitauri_kyc',
      },
    };

    if (client_email) {
      body.contact_details = { email: client_email, send_notification_emails: false };
    }

    if (first_name || last_name) {
      body.expected_details = {
        ...(first_name ? { first_name } : {}),
        ...(last_name  ? { last_name  } : {}),
        expected_document_types: ['P', 'ID', 'DL'],
      };
    }

    // 4. Call Didit API
    let session;
    try {
      const response = await fetch('https://verification.didit.me/v3/session/', {
        method:  'POST',
        headers: { 'x-api-key': tenant.didit_api_key, 'Content-Type': 'application/json' },
        body:    JSON.stringify(body),
      });

      if (!response.ok) {
        const errBody = await response.json().catch(() => ({}));
        const msg = errBody?.detail || errBody?.workflow_id?.[0] || `Didit API error ${response.status}`;
        return Response.json({ error: msg });
      }

      session = await response.json();
    } catch (err) {
      return Response.json({ error: `Network error: ${err.message}` });
    }

    // 5. Store Didit session on the OutreachRequest item
    try {
      const outreachList = await base44.asServiceRole.entities.OutreachRequest.filter({ id: outreach_id });
      const req = outreachList?.[0];
      if (req) {
        const updatedItems = (req.items || []).map(it =>
          it.item_id === item_id
            ? {
                ...it,
                didit_session_id:     session.session_id,
                didit_session_url:    session.url,
                didit_session_status: 'Not Started',
                idv_status:           'Pending',
                idv_provider:         'didit',
              }
            : it
        );
        await base44.asServiceRole.entities.OutreachRequest.update(outreach_id, { items: updatedItems });
      }
    } catch (err) {
      console.error('Could not store Didit session on OutreachRequest:', err);
    }

    // 6. Return session URL to the portal
    return Response.json({
      session_id:  session.session_id,
      session_url: session.url,
    });

  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});