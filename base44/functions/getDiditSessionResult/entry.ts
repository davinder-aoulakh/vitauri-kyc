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

    return Response.json({ ok: true, ...idvFields });

  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});