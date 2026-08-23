import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json();
    const { session_id, tenant_id, didit_api_key: directApiKey, action = 'details' } = body;

    console.log('=== getDiditSessionDetails called ===');
    console.log('action:', action);
    console.log('session_id:', session_id);
    console.log('tenant_id:', tenant_id);
    console.log('direct_api_key provided:', !!directApiKey, 'length:', directApiKey?.length ?? 0);

    if (!session_id) {
      console.log('ERROR: session_id missing');
      return Response.json({ error: 'session_id is required' });
    }

    // Use directly-passed API key, or fall back to tenant lookup
    let apiKey = directApiKey?.trim();
    if (!apiKey) {
      if (!tenant_id) return Response.json({ error: 'Either didit_api_key or tenant_id is required' });
      const tenants = await base44.asServiceRole.entities.Tenant.filter({ id: tenant_id });
      apiKey = tenants?.[0]?.didit_api_key?.trim();
      console.log('API key from tenant lookup:', !!apiKey, 'length:', apiKey?.length ?? 0);
    } else {
      console.log('API key from direct param: length', apiKey.length, 'prefix:', apiKey.substring(0, 8));
    }
    if (!apiKey) {
      console.log('ERROR: no API key found');
      return Response.json({ error: 'Didit not configured for this tenant' });
    }

    // ── PDF generation ──────────────────────────────────────────────────────
    // Didit API: GET /v3/session/{sessionId}/generate-pdf/ returns raw binary PDF
    // Session must be Approved, Declined, or In Review — otherwise 403
    if (action === 'generate_pdf') {
      try {
        // Log all inputs for debugging
        console.log('PDF request inputs:', {
          session_id,
          session_id_length: session_id?.length,
          api_key_length: apiKey?.length,
          api_key_prefix: apiKey?.substring(0, 12),
          api_key_suffix: apiKey?.slice(-4),
          tenant_id,
          direct_key_provided: !!directApiKey,
        });

        // Try multiple known Didit PDF endpoint variants
        const urlsToTry = [
          `https://verification.didit.me/v3/session/${session_id}/generate-pdf/`,
          `https://verification.didit.me/v3/session/${session_id}/generate-pdf`,
          `https://verification.didit.me/v2/session/${session_id}/generate-pdf/`,
          `https://verification.didit.me/v1/session/${session_id}/generate-pdf/`,
        ];

        let pdfResp: Response | null = null;
        let usedUrl = '';
        for (const url of urlsToTry) {
          console.log('Trying PDF URL:', url);
          const resp = await fetch(url, {
            method: 'GET',
            headers: { 'x-api-key': apiKey },
          });
          console.log(`  → status: ${resp.status}, content-type: ${resp.headers.get('content-type')}`);
          if (resp.ok) {
            pdfResp = resp;
            usedUrl = url;
            break;
          }
          // Log error body for each failed attempt
          const errBody = await resp.text().catch(() => '');
          console.log(`  → error body: ${errBody.substring(0, 200)}`);
          // Keep trying on 404; stop on auth errors
          if (resp.status === 401 || resp.status === 403) {
            return Response.json({ error: `PDF auth failed (${resp.status}): ${errBody || 'check API key'}` });
          }
        }

        if (!pdfResp) {
          return Response.json({ error: `PDF generation failed: 404 on all endpoint variants. Session ID: ${session_id}. Check Didit console that this session exists and PDF feature is enabled.` });
        }

        console.log('PDF success — used URL:', usedUrl);

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
        { headers: { 'x-api-key': apiKey } }
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