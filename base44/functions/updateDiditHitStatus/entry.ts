import { createClientFromRequest } from 'npm:@base44/sdk@0.8.43';

/**
 * Updates the review_status of a specific AML hit in Didit.
 * Didit API: PATCH /v3/session/{sessionId}/aml-screening/{screeningId}/hits/{hitId}/
 * Valid review_status values: "Unreviewed", "Confirmed Match", "False Positive", "Inconclusive"
 */
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json();
    const { session_id, screening_id, hit_id, review_status, tenant_id, didit_api_key: directApiKey } = body;

    console.log('updateDiditHitStatus called:', { session_id, hit_id, review_status, has_api_key: !!directApiKey });

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

    // Resolve screening_id if not provided — fetch from session decision
    let resolvedScreeningId = screening_id;
    if (!resolvedScreeningId) {
      const decisionResp = await fetch(
        `https://verification.didit.me/v3/session/${session_id}/decision/`,
        { headers: { 'x-api-key': apiKey } }
      );
      if (!decisionResp.ok) {
        const errText = await decisionResp.text();
        console.log('Decision fetch failed:', decisionResp.status, errText);
        return Response.json({ error: `Could not fetch session decision: ${decisionResp.status}` }, { status: 502 });
      }
      const decision = await decisionResp.json();
      const root = decision?.decision || decision || {};
      // The AML screening node can be at aml_screenings[] or nested under the session
      resolvedScreeningId = root.aml_screenings?.[0]?.id || root.first_aml?.id || null;
      console.log('Resolved screening_id:', resolvedScreeningId, 'root keys:', Object.keys(root));
    }

    if (!resolvedScreeningId) {
      return Response.json({ error: 'Could not find aml_screening id for this session' }, { status: 400 });
    }

    // PATCH hit status in Didit
    const url = `https://verification.didit.me/v3/session/${session_id}/aml-screening/${resolvedScreeningId}/hits/${hit_id}/`;
    console.log('PATCH', url, '->', review_status);

    const resp = await fetch(url, {
      method: 'PATCH',
      headers: { 'x-api-key': apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ review_status }),
    });

    const respText = await resp.text();
    console.log('Didit PATCH response:', resp.status, respText.substring(0, 300));

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