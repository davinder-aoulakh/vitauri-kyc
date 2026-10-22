import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';
import { fetchDiditDecision, normaliseDateString, ISO3_MAP, primaryCheck } from '../../shared/diditDecision.js';
import { rehostDiditImage } from '../../shared/diditMedia.js';
import { authorizeOutreachCaller } from '../../shared/diditSessionAuth.js';
import { withDiditCredentials } from '../../shared/diditCredentials.js';
import { applyRelatedPartyIdv } from '../../shared/kybRelatedParty.js';

export default async function(req) {
  try {
    const base44 = createClientFromRequest(req);
    const params = await req.json();
    const { outreach_id, access_token } = params;
    let { session_id, item_id } = params;

    if (!outreach_id) {
      return Response.json({ error: 'Missing required parameters' });
    }

    // 0. Caller check: portal access_token or a signed-in user of the outreach's tenant (Vitauri Ops: any).
    //    The tenant always comes from the stored outreach.
    const auth = await authorizeOutreachCaller(base44, { outreach_id, access_token, tenant_id: params.tenant_id });
    if (auth.error) return auth.error;
    const tenant_id = auth.outreach.tenant_id;

    // 1. Load tenant API key
    const tenants = await base44.asServiceRole.entities.Tenant.filter({ id: tenant_id });
    const tenant  = await withDiditCredentials(base44, tenants?.[0]);
    if (!tenant?.didit_api_key) return Response.json({ error: 'Didit not configured' });

    // 2. Resolve the session from the stored item (try item, then fallback parse response_text JSON).
    //    A session_id in the request must match the stored one; it is never trusted on its own.
    {
      const items0 = auth.outreach.items || [];
      const targetItem = item_id
        ? items0.find(i => i.item_id === item_id)
        : (session_id && items0.find(i => i.didit_session_id === session_id)) ||
          items0.find(i => i.field_type === 'id_verification' || i.didit_session_id ||
            (i.item_type === 'data_point' && (i.label || '').toLowerCase().includes('id')));

      let storedSessionId = null;
      if (targetItem?.didit_session_id) {
        storedSessionId = targetItem.didit_session_id;
      } else if (targetItem?.response_text) {
        // Fallback: parse raw JSON dumped by old portal submit bug
        try {
          const parsed = JSON.parse(targetItem.response_text);
          storedSessionId = parsed?.didit_session_id || parsed?.session_id || null;
          if (storedSessionId && !item_id) item_id = targetItem.item_id;
        } catch {}
      }
      if (session_id && storedSessionId && session_id !== storedSessionId) {
        return Response.json({ error: 'Session does not belong to this request' }, { status: 403 });
      }
      session_id = storedSessionId;
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
    const idv  = primaryCheck(root.id_verifications);
    const face = primaryCheck(root.face_matches);
    const live = primaryCheck(root.liveness_checks);

    // 4. Update item with fresh AML/IDV fields — always runs, even if already processed
    //    (document creation below has its own separate dedup guard)
    try {
      const outreachList = await base44.asServiceRole.entities.OutreachRequest.filter({ id: outreach_id });
      const outreachReq  = outreachList?.[0];
      if (outreachReq) {
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
      // Didit KYB: a related party's own verification updates the RelatedParty, never the company Client.
      if (req6?.related_party_id && req6.tenant_id === tenant_id) {
        await applyRelatedPartyIdv(base44, { tenantId: tenant_id, outreach: req6, sessionId: session_id, idvFields, amlScreenings: root.aml_screenings });
      } else if (clientId) {
        const client = (await base44.asServiceRole.entities.Client.filter({ id: clientId }))?.[0];
        // An organisation client never receives a person's identity data (name, DOB, ID document).
        const isOrgClient = client?.client_type === 'ORG';
        if (client && isOrgClient) {
          base44.asServiceRole.entities.AuditEvent.create({
            tenant_id, client_id: client.id, case_id: req6?.case_id || null, actor_type: 'System', actor_name: 'Didit IDV',
            event_type: 'idv_person_data_not_applied',
            notes: `Didit ID check ${session_id} completed on an organisation request; person identity data was not written to the organisation profile.`,
          }).catch(() => {});
        }
        if (client) {
          const updates = {};
          const diditFullName = [idvFields.idv_extracted_first_name, idvFields.idv_extracted_last_name].filter(Boolean).join(' ');
          if (!isOrgClient && diditFullName && !client.full_name) updates.full_name = diditFullName;
          if (!isOrgClient && idvFields.idv_extracted_dob && !client.date_of_birth) updates.date_of_birth = idvFields.idv_extracted_dob;
          if (!isOrgClient && idvFields.idv_extracted_nationality && !client.nationality) {
            updates.nationality = ISO3_MAP[idvFields.idv_extracted_nationality] || idvFields.idv_extracted_nationality;
          }
          if (!isOrgClient && idvFields.idv_issuing_country && !client.country_of_residence) {
            updates.country_of_residence = ISO3_MAP[idvFields.idv_issuing_country] || idvFields.idv_issuing_country;
          }
          if (!isOrgClient && idvFields.idv_document_number && !client.id_number) updates.id_number = idvFields.idv_document_number;
          if (!isOrgClient && idvFields.idv_document_expiry && !client.id_expiry_date) updates.id_expiry_date = idvFields.idv_document_expiry;
          if (!isOrgClient && idvFields.idv_document_type && !client.id_type) {
            const ID_TYPE_MAP = { 'Passport':'Passport','Identity Card':'National ID Card','National ID':'National ID Card',"Driver's License":'Driving Licence','Driving Licence':'Driving Licence','Residence Permit':'Residence Permit' };
            updates.id_type = ID_TYPE_MAP[idvFields.idv_document_type] || 'Other';
          }
          if (idvFields.idv_status === 'Pass' && client.status === 'Prospect') updates.status = 'Active';
          if (!isOrgClient && client.date_of_birth) {
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

    // 7. Create Document records — DB-level dedup guard (survives races and webhook pre-sets)
    try {
      const req7      = (await base44.asServiceRole.entities.OutreachRequest.filter({ id: outreach_id }))?.[0];
      const clientId7 = req7?.client_id;
      const rpDoc = req7?.related_party_id ? { related_party_id: req7.related_party_id } : {};
      if (clientId7) {
        // Fast-path: if flag already set, skip entirely
        const guardItem = (req7?.items || []).find(i => item_id ? i.item_id === item_id : i.didit_session_id === session_id);
        if (guardItem?.idv_docs_created_for_session !== session_id) {
          // Authoritative guard: query existing docs for this session to handle concurrent calls
          const existingDiditDocs = await base44.asServiceRole.entities.Document.filter({ didit_session_id: session_id, is_deleted: false });
          const existingDocTypes = new Set((existingDiditDocs || []).map((d: any) => d.doc_type));

          const docType = (idvFields.idv_document_type || '').toLowerCase().includes('passport') ? 'Passport' : 'ID_Card';
          const existingNames = new Set((existingDiditDocs || []).map((d: any) => d.file_name));

          // Didit image URLs expire: store a private copy. If any image could not be stored, the claim flag is
          // not set, so the next sync (with fresh URLs) tries again.
          let allStored = true;
          const storeImage = async (url: string, docTypeValue: string, fileName: string, reviewStatus: string) => {
            const fileUri = await rehostDiditImage(base44, url, fileName);
            if (!fileUri) { allStored = false; return; }
            await base44.asServiceRole.entities.Document.create({ tenant_id, client_id: clientId7, doc_type: docTypeValue, file_name: fileName, file_url: fileUri, version: 1, is_ai_generated: false, review_status: reviewStatus, source: 'didit', didit_session_id: session_id, ...rpDoc }).catch(() => {});
          };
          const idReview = idvFields.idv_status === 'Pass' ? 'Approved' : 'Pending_Review';

          if (idv.front_image && !existingDocTypes.has(docType)) {
            await storeImage(idv.front_image, docType, `Didit_${docType}_Front_${session_id.substring(0,8)}.jpg`, idReview);
          }
          const backName = `Didit_${docType}_Back_${session_id.substring(0,8)}.jpg`;
          if (idv.back_image && !existingNames.has(backName)) {
            await storeImage(idv.back_image, docType, backName, idReview);
          }
          if (idv.portrait_image && !existingDocTypes.has('Selfie')) {
            await storeImage(idv.portrait_image, 'Selfie', `Didit_Selfie_${session_id.substring(0,8)}.jpg`, 'Approved');
          }

          // Set claim flag so future fast-path skips this block entirely
          if (allStored) {
          const claimedItems = (req7.items || []).map((i: any) =>
            (item_id ? i.item_id === item_id : i.didit_session_id === session_id)
              ? { ...i, idv_docs_created_for_session: session_id } : i
          );
          await base44.asServiceRole.entities.OutreachRequest.update(outreach_id, { items: claimedItems });
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