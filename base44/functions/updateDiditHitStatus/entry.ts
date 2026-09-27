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
    const { session_id, hit_id, review_status, tenant_id, didit_api_key: directApiKey, outreach_id, item_id } = body;

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

    // Persist the fresh review_status (and any other Didit-side changes) back onto the
    // OutreachRequest item's cached idv_aml_screenings — without this, the local copy stays
    // stale and the status reverts to "Unreviewed" whenever the case is reopened.
    try {
      const decisionResp = await fetch(`https://verification.didit.me/v3/session/${session_id}/decision/`, {
        headers: { 'x-api-key': apiKey },
      });
      if (decisionResp.ok) {
        const decision = await decisionResp.json();
        const root = decision?.decision || decision || {};
        const freshAmlScreenings = root.aml_screenings || null;

        if (freshAmlScreenings) {
          // outreach_id is passed from the frontend (it already knows which OutreachRequest
          // the session belongs to) — this avoids an unsupported nested-array filter query.
          let outreachReq = null;
          if (outreach_id) {
            const list = await base44.asServiceRole.entities.OutreachRequest.filter({ id: outreach_id });
            outreachReq = list?.[0] || null;
          }
          if (outreachReq) {
            const updatedItems = (outreachReq.items || []).map((it: any) => {
              const isMatch = item_id ? it.item_id === item_id : it.didit_session_id === session_id;
              return isMatch ? { ...it, idv_aml_screenings: freshAmlScreenings } : it;
            });
            await base44.asServiceRole.entities.OutreachRequest.update(outreachReq.id, { items: updatedItems });
          }
        }
      }
    } catch (persistErr) {
      console.error('Failed to persist fresh AML screenings after status update:', persistErr);
    }

    return Response.json({ ok: true, hit_id, review_status, didit_response: respData });

  } catch (error) {
    console.error('updateDiditHitStatus error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});