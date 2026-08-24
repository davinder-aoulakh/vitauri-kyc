import { createClientFromRequest } from 'npm:@base44/sdk@0.8.43';

/**
 * Updates the review_status of a specific AML hit in Didit.
 * Didit API: PATCH /v3/session/{sessionId}/update-aml-hit-status/
 * Body: { hit_id, review_status }
 * Valid review_status: "Unreviewed", "Confirmed Match", "False Positive", "Inconclusive"
 */
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json();
    const { session_id, hit_id, review_status, tenant_id, didit_api_key: directApiKey } = body;

    if (!session_id || !hit_id || !review_status) {
      return Response.json({ error: 'session_id, hit_id, and review_status are required' }, { status: 400 });
    }

    const validStatuses = ['Unreviewed', 'Confirmed Match', 'False Positive', 'Inconclusive'];
    if (!validStatuses.includes(review_status)) {
      return Response.json({ error: `Invalid review_status. Must be one of: ${validStatuses.join(', ')}` }, { status: 400 });
    }

    // Resolve API key
    let apiKey = directApiKey?.trim();
    if (!apiKey && tenant_id) {
      const tenants = await base44.asServiceRole.entities.Tenant.filter({ id: tenant_id });
      apiKey = tenants?.[0]?.didit_api_key?.trim();
    }
    if (!apiKey) return Response.json({ error: 'Didit API key not configured' }, { status: 400 });

    // PATCH hit status — correct Didit V3 endpoint
    const url = `https://verification.didit.me/v3/session/${session_id}/update-aml-hit-status/`;
    console.log('PATCH', url, { hit_id, review_status });

    const resp = await fetch(url, {
      method: 'PATCH',
      headers: { 'x-api-key': apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ hit_id, review_status }),
    });

    const respText = await resp.text();
    console.log('Didit response:', resp.status, respText.substring(0, 300));

    if (!resp.ok) {
      return Response.json({ error: `Didit API error ${resp.status}: ${respText}` }, { status: resp.status });
    }

    let respData;
    try { respData = JSON.parse(respText); } catch { respData = { raw: respText }; }

    return Response.json({ ok: true, hit_id, review_status, didit_response: respData });

  } catch (error) {
    console.error('updateDiditHitStatus error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});