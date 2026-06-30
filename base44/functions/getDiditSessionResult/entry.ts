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
        // Match by item_id, or by field_type/item_type for IDV items if item_id not found
        const updatedItems = (outreachReq.items || []).map(it => {
          if (it.item_id === item_id) return { ...it, ...idvFields };
          if (!item_id && (it.field_type === 'id_verification' ||
              (it.item_type === 'data_point' && (it.label || '').toLowerCase().includes('id')))) {
            return { ...it, ...idvFields };
          }
          return it;
        });
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
          if (idvFields.idv_extracted_nationality && !client.nationality) {
            const ISO3_MAP = {
              'AUS':'Australia (AU)','NLD':'Netherlands (NL)','BEL':'Belgium (BE)',
              'DEU':'Germany (DE)','FRA':'France (FR)','GBR':'United Kingdom (GB)',
              'USA':'United States (US)','LUX':'Luxembourg (LU)','CHE':'Switzerland (CH)',
              'CAN':'Canada (CA)','NZL':'New Zealand (NZ)','SGP':'Singapore (SG)',
              'ZAF':'South Africa (ZA)','IND':'India (IN)','CHN':'China (CN)',
              'JPN':'Japan (JP)','ARE':'United Arab Emirates (AE)','BRA':'Brazil (BR)',
              'ARG':'Argentina (AR)','MYS':'Malaysia (MY)','PHL':'Philippines (PH)',
              'IDN':'Indonesia (ID)','THA':'Thailand (TH)','KOR':'South Korea (KR)',
              'PAK':'Pakistan (PK)','BGD':'Bangladesh (BD)','NGA':'Nigeria (NG)',
              'KEN':'Kenya (KE)','GHA':'Ghana (GH)','EGY':'Egypt (EG)',
              'TUR':'Turkey (TR)','ISR':'Israel (IL)','SAU':'Saudi Arabia (SA)',
              'QAT':'Qatar (QA)','KWT':'Kuwait (KW)','PRT':'Portugal (PT)',
              'ESP':'Spain (ES)','ITA':'Italy (IT)','SWE':'Sweden (SE)',
              'NOR':'Norway (NO)','DNK':'Denmark (DK)','FIN':'Finland (FI)',
              'IRL':'Ireland (IE)','POL':'Poland (PL)','CZE':'Czech Republic (CZ)',
              'HUN':'Hungary (HU)','ROU':'Romania (RO)','GRC':'Greece (GR)',
            };
            const mapped = ISO3_MAP[idvFields.idv_extracted_nationality];
            updates.nationality = mapped || 'Other';
          }
          if (idvFields.idv_document_number && !client.id_number) updates.id_number = idvFields.idv_document_number;
          if (idvFields.idv_document_expiry && !client.id_expiry_date) updates.id_expiry_date = idvFields.idv_document_expiry;

          if (idvFields.idv_document_type && !client.id_type) {
            const ID_TYPE_MAP = {
              'Passport':          'Passport',
              'Identity Card':     'National ID Card',
              'National ID':       'National ID Card',
              "Driver's License":  'Driving Licence',
              'Driving Licence':   'Driving Licence',
              'Residence Permit':  'Residence Permit',
            };
            updates.id_type = ID_TYPE_MAP[idvFields.idv_document_type] || 'Other';
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

    // ── STEP 7: Create Document records (run once only) ──────────────────────
    try {
      const req7      = (await base44.asServiceRole.entities.OutreachRequest.filter({ id: outreach_id }))?.[0];
      const clientId7 = req7?.client_id;

      if (clientId7) {

        function mapToDocType(diditType) {
          if (!diditType) return 'ID_Card';
          const t = diditType.toLowerCase();
          if (t.includes('passport')) return 'Passport';
          return 'ID_Card';
        }
        const docType = mapToDocType(idvFields.idv_document_type);

        // ── GUARD: skip if documents for THIS specific session already exist ──
        const allDocs = await base44.asServiceRole.entities.Document.filter({ client_id: clientId7 });
        const hasThisSessionDocs = (allDocs || []).some(d =>
          d.source === 'didit' && d.didit_session_id === session_id
        );
        if (hasThisSessionDocs) {
          return Response.json({ ok: true, ...idvFields });
        }

        // ── A: ID document front image (Didit signed URL) ─────────────────
        if (idv.front_image) {
          await base44.asServiceRole.entities.Document.create({
            tenant_id, client_id: clientId7,
            doc_type: docType, file_name: `Didit_${docType}_Front.jpg`,
            file_url: idv.front_image, version: 1, is_ai_generated: false,
            review_status: idvFields.idv_status === 'Pass' ? 'Approved' : 'Pending_Review',
            source: 'didit', didit_session_id: session_id,
          }).catch(e => console.error('front_image doc failed:', e));
        }

        // ── B: ID document back image ─────────────────────────────────────
        if (idv.back_image) {
          await base44.asServiceRole.entities.Document.create({
            tenant_id, client_id: clientId7,
            doc_type: docType, file_name: `Didit_${docType}_Back.jpg`,
            file_url: idv.back_image, version: 1, is_ai_generated: false,
            review_status: idvFields.idv_status === 'Pass' ? 'Approved' : 'Pending_Review',
            source: 'didit', didit_session_id: session_id,
          }).catch(e => console.error('back_image doc failed:', e));
        }

        // ── C: Selfie / portrait ──────────────────────────────────────────
        if (idv.portrait_image) {
          await base44.asServiceRole.entities.Document.create({
            tenant_id, client_id: clientId7,
            doc_type: 'Selfie', file_name: 'Didit_Selfie.jpg',
            file_url: idv.portrait_image, version: 1, is_ai_generated: false,
            review_status: 'Approved', source: 'didit', didit_session_id: session_id,
          }).catch(e => console.error('portrait doc failed:', e));
        }

        // ── D: Portal-uploaded files ──────────────────────────────────────
        for (const item of (req7?.items || [])) {
          if (!item.file_url || item.file_url.startsWith('data:')) continue;
          if (item.field_type === 'id_verification')                continue;
          if (!['Received', 'Verified'].includes(item.status))      continue;

          const portalDocType =
            item.label?.toLowerCase().includes('passport')   ? 'Passport' :
            item.label?.toLowerCase().includes('identity') ||
            item.label?.toLowerCase().includes('proof')      ? 'ID_Card'  :
            'KYC_Report';

          await base44.asServiceRole.entities.Document.create({
            tenant_id, client_id: clientId7,
            doc_type: portalDocType, file_name: item.label || 'Portal_Upload',
            file_url: item.file_url, version: 1, is_ai_generated: false,
            review_status: 'Pending_Review', source: 'portal',
          }).catch(() => {});
        }
      }
    } catch (docErr) {
      console.error('Document step failed (non-fatal):', docErr?.message);
    }

    return Response.json({ ok: true, ...idvFields });

  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});