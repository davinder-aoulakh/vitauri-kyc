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

    // ── STEP 7: Create Document records ──────────────────────────────────────
    try {
      const req7      = (await base44.asServiceRole.entities.OutreachRequest.filter({ id: outreach_id }))?.[0];
      const clientId7 = req7?.client_id;

      if (clientId7) {

        async function toBase64DataUrl(imageUrl) {
          if (!imageUrl) return null;
          try {
            const resp = await fetch(imageUrl);
            if (!resp.ok) return null;
            const arrBuf = await resp.arrayBuffer();
            const b64    = btoa(String.fromCharCode(...new Uint8Array(arrBuf)));
            return `data:image/jpeg;base64,${b64}`;
          } catch { return null; }
        }

        function mapToDocType(diditType) {
          if (!diditType) return 'ID_Card';
          const t = diditType.toLowerCase();
          if (t.includes('passport'))                                    return 'Passport';
          if (t.includes('identity') || t.includes('id card') || t.includes('national')) return 'ID_Card';
          if (t.includes('driver'))                                      return 'ID_Card';
          if (t.includes('residence'))                                   return 'ID_Card';
          return 'ID_Card';
        }

        const docType = mapToDocType(idvFields.idv_document_type);

        // ── A: Didit front image ──────────────────────────────────────────────
        const frontB64 = await toBase64DataUrl(idv.front_image);
        if (frontB64) {
          await base44.asServiceRole.entities.Document.create({
            tenant_id, client_id: clientId7,
            doc_type: docType, file_name: `Didit_${docType}_Front.jpg`,
            file_url: frontB64, version: 1, is_ai_generated: false,
            review_status: idvFields.idv_status === 'Pass' ? 'Approved' : 'Pending_Review',
            source: 'didit',
          }).catch(() => {});
        }

        // ── B: Didit back image ───────────────────────────────────────────────
        const backB64 = await toBase64DataUrl(idv.back_image);
        if (backB64) {
          await base44.asServiceRole.entities.Document.create({
            tenant_id, client_id: clientId7,
            doc_type: docType, file_name: `Didit_${docType}_Back.jpg`,
            file_url: backB64, version: 1, is_ai_generated: false,
            review_status: idvFields.idv_status === 'Pass' ? 'Approved' : 'Pending_Review',
            source: 'didit',
          }).catch(() => {});
        }

        // ── C: Selfie ─────────────────────────────────────────────────────────
        const selfiB64 = await toBase64DataUrl(idv.portrait_image);
        if (selfiB64) {
          await base44.asServiceRole.entities.Document.create({
            tenant_id, client_id: clientId7,
            doc_type: 'KYC_Report', file_name: 'Didit_Selfie.jpg',
            file_url: selfiB64, version: 1, is_ai_generated: false,
            review_status: 'Approved', source: 'didit',
          }).catch(() => {});
        }

        // ── D: Portal-uploaded files ──────────────────────────────────────────
        for (const item of (req7?.items || [])) {
          if (!item.file_url || item.file_url.startsWith('data:')) continue;
          if (item.field_type === 'id_verification') continue;
          if (!['Received', 'Verified'].includes(item.status)) continue;

          const portalDocType =
            item.label?.toLowerCase().includes('passport') ? 'Passport' :
            item.label?.toLowerCase().includes('identity') || item.label?.toLowerCase().includes('id') ? 'ID_Card' :
            'KYC_Report';

          await base44.asServiceRole.entities.Document.create({
            tenant_id, client_id: clientId7,
            doc_type: portalDocType, file_name: item.label || 'Portal_Upload',
            file_url: item.file_url, version: 1, is_ai_generated: false,
            review_status: 'Pending_Review', source: 'portal',
          }).catch(() => {});
        }

        // ── E: HTML Verification Report ───────────────────────────────────────
        const amlHits = aml.total_hits ?? 0;
        const reportHtml = `<!DOCTYPE html><html><head><meta charset="utf-8">
<title>Didit Verification Report</title>
<style>
  body{font-family:Arial,sans-serif;max-width:600px;margin:32px auto;color:#1a2332}
  h1{font-size:20px;color:#0f1f3d;border-bottom:2px solid #0f1f3d;padding-bottom:8px}
  h2{font-size:14px;color:#64748b;margin-top:20px;margin-bottom:6px;text-transform:uppercase}
  table{width:100%;border-collapse:collapse}
  td{padding:6px 8px;border-bottom:1px solid #e2e8f2;font-size:13px}
  td:first-child{color:#64748b;width:45%}
  .score{font-size:18px;font-weight:700;color:#0f1f3d}
  .badge{display:inline-block;padding:2px 10px;border-radius:20px;font-size:12px}
  .b-pass{background:#f0fdf4;color:#059669;border:1px solid #10b981}
  .b-fail{background:#fef2f2;color:#dc2626;border:1px solid #ef4444}
  .b-warn{background:#fef3c7;color:#d97706;border:1px solid #f59e0b}
</style></head><body>
<h1>🪪 Didit Identity Verification Report</h1>
<table>
  <tr><td>Session ID</td><td><code>${session_id}</code></td></tr>
  <tr><td>Decision</td><td><span class="${decision.status === 'Approved' ? 'b-pass' : 'b-fail'} badge">${decision.status}</span></td></tr>
  <tr><td>Verified At</td><td>${new Date().toLocaleString()}</td></tr>
</table>
<h2>Identity Document</h2>
<table>
  <tr><td>Document Type</td><td>${idv.document_type || '—'}</td></tr>
  <tr><td>Document Number</td><td>${idv.document_number || '—'}</td></tr>
  <tr><td>Issuing Country</td><td>${idv.issuing_state_name || idv.issuing_state || '—'}</td></tr>
  <tr><td>Expiry Date</td><td>${idv.expiration_date || '—'}</td></tr>
</table>
<h2>OCR Extracted Identity</h2>
<table>
  <tr><td>Full Name</td><td><b>${idv.full_name || [idv.first_name, idv.last_name].filter(Boolean).join(' ') || '—'}</b></td></tr>
  <tr><td>Date of Birth</td><td>${idv.date_of_birth || '—'}</td></tr>
  <tr><td>Nationality</td><td>${idv.nationality || '—'}</td></tr>
  <tr><td>Gender</td><td>${idv.gender || '—'}</td></tr>
</table>
<h2>Biometric Verification Scores</h2>
<table>
  <tr><td>Face Match Score</td><td><span class="score">${face.score != null ? Math.round(face.score) + '%' : '—'}</span> &nbsp; <span class="${face.status === 'Approved' ? 'b-pass' : 'b-fail'} badge">${face.status || '—'}</span></td></tr>
  <tr><td>Liveness Score</td><td><span class="score">${live.score != null ? Math.round(live.score) + '%' : '—'}</span> &nbsp; <span class="${live.status === 'Approved' ? 'b-pass' : 'b-fail'} badge">${live.status || '—'}</span></td></tr>
</table>
<h2>AML Screening</h2>
<table>
  <tr><td>Total Hits</td><td>${amlHits > 0 ? '<span class="b-warn badge">' + amlHits + ' hit(s)</span>' : '<span class="b-pass badge">No hits</span>'}</td></tr>
  <tr><td>Status</td><td>${aml.status || '—'}</td></tr>
</table>
${warnings.length > 0 ? `<h2>⚠ Warnings</h2><table>${warnings.map(w => `<tr><td>${w.risk || '—'}</td><td>${w.short_description || '—'}</td></tr>`).join('')}</table>` : ''}
<p style="margin-top:32px;font-size:11px;color:#94a3b8">Generated by Vitauri Platform · Verified by Didit (didit.me) · EU Data Processing</p>
</body></html>`;

        const reportB64 = btoa(unescape(encodeURIComponent(reportHtml)));
        await base44.asServiceRole.entities.Document.create({
          tenant_id, client_id: clientId7,
          doc_type: 'KYC_Report',
          file_name: `Didit_Verification_Report_${new Date().toISOString().split('T')[0]}.html`,
          file_url: `data:text/html;base64,${reportB64}`,
          version: 1, is_ai_generated: true,
          review_status: idvFields.idv_status === 'Pass' ? 'Approved' : 'Pending_Review',
          source: 'didit',
        }).catch(() => {});
      }
    } catch (docErr) {
      console.error('Document creation failed (non-fatal):', docErr?.message || docErr);
    }

    return Response.json({ ok: true, ...idvFields });

  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});