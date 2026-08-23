import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const { session_id, tenant_id, action = 'details' } = await req.json();

    if (!session_id || !tenant_id) {
      return Response.json({ error: 'session_id and tenant_id are required' });
    }

    // Load tenant API key
    const tenants = await base44.asServiceRole.entities.Tenant.filter({ id: tenant_id });
    const tenant  = tenants?.[0];
    if (!tenant?.didit_api_key) {
      return Response.json({ error: 'Didit not configured for this tenant' });
    }

    // ── PDF generation ──────────────────────────────────────────────────────
    // Didit API: GET /v3/session/{sessionId}/generate-pdf/ returns raw binary PDF
    // Session must be Approved, Declined, or In Review — otherwise 403
    if (action === 'generate_pdf') {
      try {
        // Didit PDF — exact curl equivalent: GET /v3/session/{id}/generate-pdf/ with x-api-key header
        const pdfUrl = `https://verification.didit.me/v3/session/${session_id}/generate-pdf/`;
        const apiKey = tenant.didit_api_key;
        console.log('PDF request — url:', pdfUrl, 'session_id:', session_id, 'api_key_length:', apiKey?.length, 'api_key_prefix:', apiKey?.substring(0, 8), 'api_key_suffix:', apiKey?.slice(-4));
        const pdfResp = await fetch(pdfUrl, {
          method: 'GET',
          headers: { 'x-api-key': tenant.didit_api_key },
        });
        console.log('PDF response — status:', pdfResp.status, 'content-type:', pdfResp.headers.get('content-type'));
        if (!pdfResp.ok) {
          const errText = await pdfResp.text().catch(() => '');
          console.log('PDF error body:', errText);
          return Response.json({ error: `PDF generation failed: ${pdfResp.status} — ${errText || 'no detail'}` });
        }

        // Stream binary PDF bytes → base64 data URL for the frontend to download
        const arrBuf = await pdfResp.arrayBuffer();
        const bytes  = new Uint8Array(arrBuf);
        // Use btoa-safe chunked encoding
        let binary = '';
        for (let i = 0; i < bytes.length; i += 8192) {
          binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
        }
        return Response.json({
          ok:           true,
          pdf_data_url: `data:application/pdf;base64,${btoa(binary)}`,
          filename:     `Didit_Report_${session_id.substring(0, 8)}.pdf`,
        });
      } catch (err) {
        return Response.json({ error: `PDF error: ${err.message}` });
      }
    }
    // ── end PDF branch ───────────────────────────────────────────────────────

    // Fetch full session decision from Didit
    // Fresh call = fresh signed image URLs (valid for 1 hour each)
    let decision;
    try {
      const resp = await fetch(
        `https://verification.didit.me/v3/session/${session_id}/decision/`,
        { headers: { 'x-api-key': tenant.didit_api_key } }
      );
      if (!resp.ok) {
        return Response.json({ error: `Didit API error: ${resp.status}` });
      }
      decision = await resp.json();
    } catch (err) {
      return Response.json({ error: `Network error: ${err.message}` });
    }

    // Extract and structure all the data for the frontend
    // Didit V3 returns arrays as top-level flat fields — no nested "decision" wrapper.
    // Support both shapes defensively in case the response format ever changes.
    const root = decision?.decision || decision || {};
    const idv  = root.id_verifications?.[0]  || {};
    const face = root.face_matches?.[0]       || {};
    const live = root.liveness_checks?.[0]    || {};
    const aml  = root.aml_screenings?.[0]     || {};

    // Log all top-level keys to help debug
    console.log('Didit decision keys:', Object.keys(decision || {}));
    if (decision?.decision) {
      console.log('Didit decision.decision keys:', Object.keys(decision.decision));
    }
    // Log image fields available
    console.log('IDV images:', {
      front: !!idv.front_image,
      back: !!idv.back_image,
      portrait: !!idv.portrait_image
    });
    console.log('Liveness fields:', Object.keys(live));
    console.log('Face match fields:', Object.keys(face));

    return Response.json({
      ok:          true,
      session_id,
      status:      decision.status,
      created_at:  decision.created_at,
      vendor_data: decision.vendor_data,

      // Document images (fresh signed URLs, valid 60 min)
      front_image:    idv.front_image    || null,
      back_image:     idv.back_image     || null,
      portrait_image: idv.portrait_image || null,

      // OCR extracted identity
      document_type:      idv.document_type      || null,
      document_number:    idv.document_number    || null,
      personal_number:    idv.personal_number    || null,
      issuing_state:      idv.issuing_state      || null,
      issuing_state_name: idv.issuing_state_name || null,
      expiration_date:    idv.expiration_date    || null,
      date_of_issue:      idv.date_of_issue      || null,
      first_name:         idv.first_name         || null,
      last_name:          idv.last_name          || null,
      full_name:          idv.full_name          || null,
      date_of_birth:      idv.date_of_birth      || null,
      nationality:        idv.nationality        || null,
      gender:             idv.gender             || null,
      address:            idv.address            || null,

      // Image quality scores (0–100)
      front_quality: idv.front_image_quality_score?.overall  ?? null,
      back_quality:  idv.back_image_quality_score?.overall   ?? null,

      // Biometric scores
      face_score:        face.score    ?? null,
      face_status:       face.status   || null,
      face_warnings:     face.warnings || [],
      face_selfie_image: face.face_image || face.selfie_image  || face.selfie ||
                         face.target_image || face.source_image || null,
      face_raw:          face,

      liveness_score:    live.score    ?? null,
      liveness_status:   live.status   || null,
      liveness_warnings: live.warnings || [],
      // Selfie image — try every common field name Didit might use
      liveness_image:    live.face_image  || live.selfie_image || live.image ||
                         live.portrait    || live.selfie       || null,
      liveness_raw:      live,

      // AML
      aml_total_hits: aml.total_hits ?? 0,
      aml_status:     aml.status     || null,
      aml_hits:       aml.hits       || [],
      aml_raw:        aml,

      // All warnings combined
      warnings: [
        ...(idv.warnings  || []),
        ...(face.warnings || []),
        ...(live.warnings || []),
      ],
    });

  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});