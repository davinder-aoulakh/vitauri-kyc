import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';

/**
 * Updates the review_status of a specific AML hit in Didit.
 * Didit API: PATCH /v3/session/{sessionId}/aml-screening/{screeningId}/hits/{hitId}/
 * Valid review_status values: "Unreviewed", "Confirmed Match", "False Positive", "Inconclusive"
 */
export default async function(req) {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json();
    const { session_id, screening_id, hit_id, review_status, tenant_id, didit_api_key: directApiKey } = body;

    if (!session_id || !hit_id || !review_status) {
      return Response.json({ error: 'session_id, hit_id, and review_status are required' }, { status: 400 });
    }

    // Valid Didit review_status values (matching exactly what Didit expects)
    const validStatuses = ['Unreviewed', 'Confirmed Match', 'False Positive', 'Inconclusive'];
    if (!validStatuses.includes(review_status)) {
      return Response.json({ error: `Invalid review_status. Must be one of: ${validStatuses.join(', ')}` }, { status: 400 });
    }

    // Resolve API key
    let apiKey = directApiKey?.trim();
    if (!apiKey) {
      if (!tenant_id) return Response.json({ error: 'Either didit_api_key or tenant_id is required' }, { status: 400 });
      const tenants = await base44.asServiceRole.entities.Tenant.filter({ id: tenant_id });
      apiKey = tenants?.[0]?.didit_api_key?.trim();
    }
    if (!apiKey) return Response.json({ error: 'Didit not configured for this tenant' }, { status: 400 });

    // If screening_id not provided, fetch the session decision to find it
    let resolvedScreeningId = screening_id;
    if (!resolvedScreeningId) {
      const decisionResp = await fetch(
        `https://verification.didit.me/v3/session/${session_id}/decision/`,
        { headers: { 'x-api-key': apiKey } }
      );
      if (!decisionResp.ok) {
        return Response.json({ error: `Could not fetch session to resolve screening_id: ${decisionResp.status}` }, { status: 502 });
      }
      const decision = await decisionResp.json();
      const root = decision?.decision || decision || {};
      resolvedScreeningId = root.aml_screenings?.[0]?.id;
      if (!resolvedScreeningId) {
        return Response.json({ error: 'Could not find screening_id for this session' }, { status: 400 });
      }
    }

    // PATCH the hit status in Didit
    const url = `https://verification.didit.me/v3/session/${session_id}/aml-screening/${resolvedScreeningId}/hits/${hit_id}/`;
    console.log('PATCH Didit hit status:', url, '->', review_status);

    const resp = await fetch(url, {
      method: 'PATCH',
      headers: {
        'x-api-key': apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ review_status }),
    });

    const respText = await resp.text();
    console.log('Didit PATCH response:', resp.status, respText);

    if (!resp.ok) {
      return Response.json({ error: `Didit API error ${resp.status}: ${respText}` }, { status: resp.status });
    }

    let respData;
    try { respData = JSON.parse(respText); } catch { respData = { raw: respText }; }

    return Response.json({ ok: true, hit_id, review_status, didit_response: respData });

  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}