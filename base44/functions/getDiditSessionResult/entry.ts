import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const { session_id, outreach_id, item_id, tenant_id } = await req.json();

    if (!session_id || !outreach_id || !item_id || !tenant_id) {
      return Response.json({ error: 'Missing required parameters' });
    }

    // 1. Load tenant API key (service role — portal user is unauthenticated)
    const tenants = await base44.asServiceRole.entities.Tenant.filter({ id: tenant_id });
    const tenant  = tenants?.[0];
    if (!tenant?.didit_api_key) return Response.json({ error: 'Didit not configured' });

    // 2. Fetch decision from Didit
    let decision;
    try {
      const response = await fetch(
        `https://verification.didit.me/v3/session/${session_id}/decision/`,
        { headers: { 'x-api-key': tenant.didit_api_key } }
      );

      if (!response.ok) {
        if (response.status === 404) {
          return Response.json({ idv_status: 'Pending', still_processing: true });
        }
        return Response.json({ error: `Didit API error: ${response.status}` });
      }

      decision = await response.json();
    } catch (err) {
      return Response.json({ error: `Network error: ${err.message}` });
    }

    // 3. Check for terminal status
    const TERMINAL = ['Approved', 'Declined', 'In Review', 'Abandoned', 'Expired'];
    if (!TERMINAL.includes(decision.status)) {
      return Response.json({ idv_status: 'Pending', still_processing: true });
    }

    // 4. Map Didit decision → our IDV fields
    const idv  = (decision.id_verifications || [])[0]  || {};
    const face = (decision.face_matches      || [])[0]  || {};
    const live = (decision.liveness_checks   || [])[0]  || {};
    const aml  = (decision.aml_screenings    || [])[0]  || {};

    const statusMap = {
      Approved:    'Pass',
      Declined:    'Fail',
      'In Review': 'Inconclusive',
      Abandoned:   'Fail',
      Expired:     'Expired',
    };

    const warnings = [
      ...(idv.warnings  || []),
      ...(face.warnings || []),
      ...(live.warnings || []),
    ];
    const failureReason = warnings.length > 0
      ? warnings.map(w => w.risk || w.short_description).filter(Boolean).join('; ')
      : null;

    const idvFields = {
      didit_session_id:           session_id,
      didit_session_status:       decision.status,
      idv_status:                 statusMap[decision.status] || 'Inconclusive',
      idv_similarity_score:       face.score    != null ? Math.round(face.score) : null,
      idv_liveness_passed:        live.status === 'Approved',
      idv_liveness_score:         live.score    != null ? Math.round(live.score) : null,
      idv_document_type:          idv.document_type     || null,
      idv_document_number:        idv.document_number   || null,
      idv_document_expiry:        idv.expiration_date   || null,
      idv_extracted_first_name:   idv.first_name        || null,
      idv_extracted_last_name:    idv.last_name         || null,
      idv_extracted_dob:          idv.date_of_birth     || null,
      idv_extracted_nationality:  idv.nationality       || null,
      idv_issuing_country:        idv.issuing_state     || null,
      idv_failure_reason:         failureReason,
      idv_aml_hits:               aml.total_hits        != null ? aml.total_hits : 0,
      idv_checked_at:             new Date().toISOString(),
      idv_provider:               'didit',
    };

    // 5. Update the OutreachRequest item
    try {
      const outreachList = await base44.asServiceRole.entities.OutreachRequest.filter({ id: outreach_id });
      const outreachReq  = outreachList?.[0];
      if (outreachReq) {
        const updatedItems = (outreachReq.items || []).map(it =>
          it.item_id === item_id ? { ...it, ...idvFields } : it
        );
        await base44.asServiceRole.entities.OutreachRequest.update(outreach_id, { items: updatedItems });
      }
    } catch (err) {
      console.error('Could not update OutreachRequest with IDV result:', err);
    }

    // 6. Audit event (non-blocking)
    base44.asServiceRole.entities.AuditEvent.create({
      tenant_id,
      actor_type: 'System',
      actor_name: 'Didit IDV',
      event_type: 'idv_completed',
      notes: `Didit: ${decision.status}. ` +
             `Face match: ${face.score != null ? Math.round(face.score) + '%' : 'N/A'}. ` +
             `Document: ${idv.document_type || 'unknown'}. ` +
             `Liveness: ${live.status || 'N/A'}. ` +
             (failureReason ? `Issues: ${failureReason}` : ''),
    }).catch(() => {});

    // ── STEP 6: Enrich Client entity ─────────────────────────────────────────
    try {
      const outreachList6 = await base44.asServiceRole.entities.OutreachRequest.filter({ id: outreach_id });
      const req6 = outreachList6?.[0];
      const clientId = req6?.client_id;

      if (clientId) {
        const clientList = await base44.asServiceRole.entities.Client.filter({ id: clientId });
        const client = clientList?.[0];

        if (client) {
          const updates = {};

          // ── Apply Didit OCR fields (only if not already set on client) ──────
          const diditFullName = [idvFields.idv_extracted_first_name, idvFields.idv_extracted_last_name]
            .filter(Boolean).join(' ');
          if (diditFullName && !client.full_name) updates.full_name = diditFullName;
          if (idvFields.idv_extracted_dob && !client.date_of_birth) updates.date_of_birth = idvFields.idv_extracted_dob;
          if (idvFields.idv_extracted_nationality && !client.nationality) updates.nationality = idvFields.idv_extracted_nationality;
          if (idvFields.idv_document_number && !client.id_number) updates.id_number = idvFields.idv_document_number;
          if (idvFields.idv_document_expiry && !client.id_expiry_date) updates.id_expiry_date = idvFields.idv_document_expiry;

          if (idvFields.idv_document_type && !client.id_type) {
            const docTypeMap = {
              'Passport': 'Passport',
              'Identity Card': 'National ID',
              "Driver's License": 'Driving Licence',
              'Driving Licence': 'Driving Licence',
              'Residence Permit': 'Residence Permit',
            };
            updates.id_type = docTypeMap[idvFields.idv_document_type] || idvFields.idv_document_type;
          }

          if (idvFields.idv_issuing_country && !client.registered_country) {
            updates.registered_country = idvFields.idv_issuing_country;
          }

          // ── Scan other outreach items for form responses ──────────────────
          for (const itm of (req6?.items || [])) {
            if (!itm.response_text || !['Received', 'Verified'].includes(itm.status)) continue;
            const lbl = (itm.label || '').toLowerCase();
            const val = itm.response_text.trim();
            if (!val) continue;

            if ((lbl.includes('email') || lbl.includes('e-mail')) && !client.primary_contact_email && !updates.primary_contact_email) updates.primary_contact_email = val;
            if ((lbl.includes('phone') || lbl.includes('mobile') || lbl.includes('tel')) && !client.primary_contact_phone && !updates.primary_contact_phone) updates.primary_contact_phone = val;
            if ((lbl.includes('address') || lbl.includes('residential') || lbl.includes('home address')) && !client.registered_address && !updates.registered_address) updates.registered_address = val;
            if ((lbl.includes('contact name') || lbl.includes('representative')) && !client.primary_contact_name && !updates.primary_contact_name) updates.primary_contact_name = val;
            if ((lbl.includes('country of residence') || lbl.includes('country')) && !client.country_of_residence && !updates.country_of_residence) updates.country_of_residence = val;
          }

          // ── Promote client status ─────────────────────────────────────────
          if (idvFields.idv_status === 'Pass' && client.status === 'Prospect') {
            updates.status = 'Active';
          }

          if (Object.keys(updates).length > 0) {
            await base44.asServiceRole.entities.Client.update(client.id, updates);

            base44.asServiceRole.entities.AuditEvent.create({
              tenant_id,
              actor_type: 'System',
              actor_name: 'Didit IDV',
              event_type: 'client_enriched',
              client_id:  client.id,
              notes: `Client profile enriched from Didit verification. Fields updated: ${Object.keys(updates).join(', ')}.` +
                     (updates.status ? ` Status promoted to: ${updates.status}.` : ''),
            }).catch(() => {});
          }
        }
      }
    } catch (enrichErr) {
      console.error('Client enrichment failed:', enrichErr);
    }

    // ── STEP 7: Download Didit images and create Document records ────────────
    try {
      const outreachList7 = await base44.asServiceRole.entities.OutreachRequest.filter({ id: outreach_id });
      const clientId7     = outreachList7?.[0]?.client_id;

      if (clientId7 && idvFields.idv_status !== 'Pending') {

        async function fetchAndUpload(imageUrl, filename) {
          if (!imageUrl) return null;
          try {
            const resp = await fetch(imageUrl);
            if (!resp.ok) return null;
            const arrayBuffer = await resp.arrayBuffer();
            const uint8 = new Uint8Array(arrayBuffer);
            const blob = new Blob([uint8], { type: 'image/jpeg' });
            const formData = new FormData();
            formData.append('file', blob, filename);
            // Use base44 SDK upload via integrations
            const result = await base44.asServiceRole.integrations.Core.UploadFile({ file: blob });
            return result?.file_url || null;
          } catch {
            return null;
          }
        }

        function mapDocType(diditType) {
          if (!diditType) return 'ID_Card';
          const t = diditType.toLowerCase();
          if (t.includes('passport')) return 'Passport';
          return 'ID_Card';
        }

        const docType    = mapDocType(idvFields.idv_document_type);
        const reviewStat = idvFields.idv_status === 'Pass' ? 'Approved' : 'Pending_Review';
        const sidShort   = session_id.substring(0, 8);

        const imageUploads = await Promise.all([
          fetchAndUpload(idv.front_image,    `didit_${docType.toLowerCase()}_front_${sidShort}.jpg`),
          fetchAndUpload(idv.back_image,     `didit_${docType.toLowerCase()}_back_${sidShort}.jpg`),
          fetchAndUpload(idv.portrait_image, `didit_selfie_${sidShort}.jpg`),
        ]);

        const docRecords = [];
        if (imageUploads[0]) docRecords.push({ doc_type: docType,    file_name: `${docType}_front.jpg`,       file_url: imageUploads[0], review_status: reviewStat, is_ai_generated: false });
        if (imageUploads[1]) docRecords.push({ doc_type: docType,    file_name: `${docType}_back.jpg`,        file_url: imageUploads[1], review_status: reviewStat, is_ai_generated: false });
        if (imageUploads[2]) docRecords.push({ doc_type: 'KYC_Report', file_name: 'Selfie_Verification.jpg', file_url: imageUploads[2], review_status: 'Approved',  is_ai_generated: false });

        for (const doc of docRecords) {
          await base44.asServiceRole.entities.Document.create({
            tenant_id, client_id: clientId7, version: 1, ...doc,
          }).catch(e => console.error('Could not create Document record:', e));
        }

        // ── KYC Verification text report ─────────────────────────────────────
        const reportLines = [
          '=== DIDIT IDENTITY VERIFICATION REPORT ===',
          `Session ID: ${session_id}`,
          `Decision:   ${decision.status}`,
          `Checked at: ${new Date().toISOString()}`,
          '',
          '--- DOCUMENT ---',
          `Type:        ${idv.document_type || '—'}`,
          `Number:      ${idv.document_number || '—'}`,
          `Issuing:     ${idv.issuing_state_name || idv.issuing_state || '—'}`,
          `Expiry:      ${idv.expiration_date || '—'}`,
          '',
          '--- OCR EXTRACTED IDENTITY ---',
          `Full Name:   ${[idv.first_name, idv.last_name].filter(Boolean).join(' ') || '—'}`,
          `Date of Birth: ${idv.date_of_birth || '—'}`,
          `Nationality: ${idv.nationality || '—'}`,
          `Gender:      ${idv.gender || '—'}`,
          '',
          '--- BIOMETRIC SCORES ---',
          `Face Match:  ${face.score != null ? Math.round(face.score) + '%' : '—'} (${face.status || '—'})`,
          `Liveness:    ${live.score != null ? Math.round(live.score) + '%' : '—'} (${live.status || '—'})`,
          '',
          '--- AML SCREENING ---',
          `Total Hits:  ${aml.total_hits != null ? aml.total_hits : '—'}`,
          `Status:      ${aml.status || '—'}`,
          '',
          '--- WARNINGS ---',
          ...(warnings.length > 0
            ? warnings.map(w => `• ${w.risk || '—'}: ${w.short_description || '—'}`)
            : ['None']),
        ].join('\n');

        const encoder     = new TextEncoder();
        const reportBytes = encoder.encode(reportLines);
        const reportBlob  = new Blob([reportBytes], { type: 'text/plain' });
        const reportUpload = await base44.asServiceRole.integrations.Core.UploadFile({ file: reportBlob }).catch(() => null);

        if (reportUpload?.file_url) {
          await base44.asServiceRole.entities.Document.create({
            tenant_id,
            client_id:    clientId7,
            doc_type:     'KYC_Report',
            file_name:    `Didit_Verification_Report_${new Date().toISOString().split('T')[0]}.txt`,
            file_url:     reportUpload.file_url,
            version:      1,
            is_ai_generated: true,
            review_status:   reviewStat,
          }).catch(e => console.error('Could not create KYC Report document:', e));
        }
      }
    } catch (docErr) {
      console.error('Document creation step failed:', docErr);
    }

    return Response.json({ ok: true, ...idvFields });

  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});