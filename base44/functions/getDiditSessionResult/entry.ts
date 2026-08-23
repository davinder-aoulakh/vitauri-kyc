import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';
import { fetchDiditDecision, normaliseDateString } from '../../shared/diditDecision.js';

export default async function(req) {
  try {
    const base44 = createClientFromRequest(req);
    let { session_id, outreach_id, item_id, tenant_id } = await req.json();

    if (!outreach_id || !tenant_id) {
      return Response.json({ error: 'Missing required parameters' });
    }

    // 1. Load tenant API key
    const tenants = await base44.asServiceRole.entities.Tenant.filter({ id: tenant_id });
    const tenant  = tenants?.[0];
    if (!tenant?.didit_api_key) return Response.json({ error: 'Didit not configured' });

    // 2. Resolve session_id if not provided — try item, then fallback parse response_text JSON
    if (!session_id) {
      const outreachList0 = await base44.asServiceRole.entities.OutreachRequest.filter({ id: outreach_id });
      const req0 = outreachList0?.[0];
      const items0 = req0?.items || [];
      const targetItem = item_id
        ? items0.find(i => i.item_id === item_id)
        : items0.find(i => i.field_type === 'id_verification' || i.didit_session_id ||
            (i.item_type === 'data_point' && (i.label || '').toLowerCase().includes('id')));

      if (targetItem?.didit_session_id) {
        session_id = targetItem.didit_session_id;
      } else if (targetItem?.response_text) {
        // Fallback: parse raw JSON dumped by old portal submit bug
        try {
          const parsed = JSON.parse(targetItem.response_text);
          session_id = parsed?.didit_session_id || parsed?.session_id;
          if (!item_id) item_id = targetItem.item_id;
        } catch {}
      }
    }

    if (!session_id) {
      return Response.json({ idv_status: 'Pending', still_processing: true, no_session: true });
    }

    // 3. Fetch decision from Didit
    let fetchResult;
    try {
      fetchResult = await fetchDiditDecision(session_id, tenant.didit_api_key);
    } catch (err) {
      return Response.json({ error: `Network error: ${err.message}` });
    }

    if (fetchResult.pending) {
      return Response.json({ idv_status: 'Pending', still_processing: true });
    }

    const { decision, idvFields } = fetchResult;
    const root = decision?.decision || decision || {};
    const idv  = root.id_verifications?.[0] || {};
    const face = root.face_matches?.[0]      || {};
    const live = root.liveness_checks?.[0]   || {};
    const aml  = root.aml_screenings?.[0]    || {};

    // 4. Idempotency guard: update item only if not already processed for this session
    try {
      const outreachList = await base44.asServiceRole.entities.OutreachRequest.filter({ id: outreach_id });
      const outreachReq  = outreachList?.[0];
      if (outreachReq) {
        const existingItem = (outreachReq.items || []).find(i =>
          item_id ? i.item_id === item_id : i.didit_session_id === session_id
        );
        if (existingItem?.idv_docs_created_for_session === session_id && existingItem?.idv_status && existingItem.idv_status !== 'Pending') {
          // Already fully processed — return cached result immediately
          return Response.json({ ok: true, ...idvFields, cached: true });
        }

        const updatedItems = (outreachReq.items || []).map(it => {
          const isMatch = item_id ? it.item_id === item_id : (it.didit_session_id === session_id ||
            it.field_type === 'id_verification' ||
            (it.item_type === 'data_point' && (it.label || '').toLowerCase().includes('id')));
          if (isMatch) return { ...it, ...idvFields, status: idvFields.idv_status === 'Pass' ? 'Received' : 'Requested' };
          return it;
        });
        await base44.asServiceRole.entities.OutreachRequest.update(outreach_id, { items: updatedItems });
      }
    } catch (err) {
      console.error('Could not update OutreachRequest with IDV result:', err);
    }

    // 5. Audit event (non-blocking)
    base44.asServiceRole.entities.AuditEvent.create({
      tenant_id,
      actor_type: 'System',
      actor_name: 'Didit IDV',
      event_type: 'idv_completed',
      notes: `Didit: ${decision.status}. Face: ${face.score != null ? Math.round(face.score) + '%' : 'N/A'}. Document: ${idv.document_type || 'unknown'}. Liveness: ${live.status || 'N/A'}.`,
    }).catch(() => {});

    // 6. Enrich Client entity
    try {
      const req6 = (await base44.asServiceRole.entities.OutreachRequest.filter({ id: outreach_id }))?.[0];
      const clientId = req6?.client_id;
      if (clientId) {
        const client = (await base44.asServiceRole.entities.Client.filter({ id: clientId }))?.[0];
        if (client) {
          const updates = {};
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
          const diditFullName = [idvFields.idv_extracted_first_name, idvFields.idv_extracted_last_name].filter(Boolean).join(' ');
          if (diditFullName && !client.full_name) updates.full_name = diditFullName;
          if (idvFields.idv_extracted_dob && !client.date_of_birth) updates.date_of_birth = idvFields.idv_extracted_dob;
          if (idvFields.idv_extracted_nationality && !client.nationality) {
            updates.nationality = ISO3_MAP[idvFields.idv_extracted_nationality] || 'Other';
          }
          if (idvFields.idv_document_number && !client.id_number) updates.id_number = idvFields.idv_document_number;
          if (idvFields.idv_document_expiry && !client.id_expiry_date) updates.id_expiry_date = idvFields.idv_document_expiry;
          if (idvFields.idv_document_type && !client.id_type) {
            const ID_TYPE_MAP = { 'Passport':'Passport','Identity Card':'National ID Card','National ID':'National ID Card',"Driver's License":'Driving Licence','Driving Licence':'Driving Licence','Residence Permit':'Residence Permit' };
            updates.id_type = ID_TYPE_MAP[idvFields.idv_document_type] || 'Other';
          }
          if (idvFields.idv_status === 'Pass' && client.status === 'Prospect') updates.status = 'Active';
          if (client.date_of_birth) {
            const normalisedDob = normaliseDateString(client.date_of_birth);
            if (normalisedDob && normalisedDob !== client.date_of_birth) updates.date_of_birth = normalisedDob;
          }
          for (const itm of (req6?.items || [])) {
            if (!itm.response_text || !['Received', 'Verified'].includes(itm.status)) continue;
            const lbl = (itm.label || '').toLowerCase();
            const val = itm.response_text.trim();
            if (!val) continue;
            if ((lbl.includes('email') || lbl.includes('e-mail')) && !client.primary_contact_email && !updates.primary_contact_email) updates.primary_contact_email = val;
            if ((lbl.includes('phone') || lbl.includes('mobile') || lbl.includes('tel')) && !client.primary_contact_phone && !updates.primary_contact_phone) updates.primary_contact_phone = val;
            if ((lbl.includes('address') || lbl.includes('residential')) && !client.registered_address && !updates.registered_address) updates.registered_address = val;
          }
          if (Object.keys(updates).length > 0) {
            await base44.asServiceRole.entities.Client.update(client.id, updates);
          }
        }
      }
    } catch (enrichErr) {
      console.error('Client enrichment failed:', enrichErr);
    }

    // 7. Create Document records (idempotent via guard flag)
    try {
      const req7      = (await base44.asServiceRole.entities.OutreachRequest.filter({ id: outreach_id }))?.[0];
      const clientId7 = req7?.client_id;
      if (clientId7) {
        const guardItem = (req7?.items || []).find(i => item_id ? i.item_id === item_id : i.didit_session_id === session_id);
        if (guardItem?.idv_docs_created_for_session !== session_id) {
          // Claim the session
          const claimedItems = (req7.items || []).map(i =>
            (item_id ? i.item_id === item_id : i.didit_session_id === session_id)
              ? { ...i, idv_docs_created_for_session: session_id } : i
          );
          await base44.asServiceRole.entities.OutreachRequest.update(outreach_id, { items: claimedItems });

          const docType = (idvFields.idv_document_type || '').toLowerCase().includes('passport') ? 'Passport' : 'ID_Card';
          if (idv.front_image) {
            await base44.asServiceRole.entities.Document.create({ tenant_id, client_id: clientId7, doc_type: docType, file_name: `Didit_${docType}_Front_${session_id.substring(0,8)}.jpg`, file_url: idv.front_image, version: 1, is_ai_generated: false, review_status: idvFields.idv_status === 'Pass' ? 'Approved' : 'Pending_Review', source: 'didit', didit_session_id: session_id }).catch(() => {});
          }
          if (idv.back_image) {
            await base44.asServiceRole.entities.Document.create({ tenant_id, client_id: clientId7, doc_type: docType, file_name: `Didit_${docType}_Back_${session_id.substring(0,8)}.jpg`, file_url: idv.back_image, version: 1, is_ai_generated: false, review_status: idvFields.idv_status === 'Pass' ? 'Approved' : 'Pending_Review', source: 'didit', didit_session_id: session_id }).catch(() => {});
          }
          if (idv.portrait_image) {
            await base44.asServiceRole.entities.Document.create({ tenant_id, client_id: clientId7, doc_type: 'Selfie', file_name: `Didit_Selfie_${session_id.substring(0,8)}.jpg`, file_url: idv.portrait_image, version: 1, is_ai_generated: false, review_status: 'Approved', source: 'didit', didit_session_id: session_id }).catch(() => {});
          }
        }
      }
    } catch (docErr) {
      console.error('Document step failed:', docErr?.message);
    }

    return Response.json({ ok: true, ...idvFields });

  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}