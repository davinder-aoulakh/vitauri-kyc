// sendKeyPersonIdv — create a separate client-portal request asking one UBO/director (RelatedParty) of an organisation
// client to complete their own Didit identity verification. vendor_data for that session is the related party (see
// createDiditSession). Auth: signed-in user with createRunCase, own tenant. Requires didit_kyb. Respects the tipping-off lock.
// Returns the portal link; the caller emails it (Core.SendEmail) or hands it over.
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.52';
import { authenticate, asList, errorResponse, httpError, loadTenant } from '../../shared/tmAuth.js';
import { isKybEnabled, pickWorkflow, parseWorkflows } from '../../shared/diditWorkflows.js';
import { assertClientNotLocked } from '../../shared/tippingOff.js';

const CREATE_RUN_CASE = ['Analyst', 'QC Reviewer', 'Compliance Officer', 'Manager', 'Director', 'Compliance Admin', 'Tenant Admin'];
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default async function (req) {
  try {
    const base44 = createClientFromRequest(req);
    const body = await req.json().catch(() => ({}));
    const auth = await authenticate(base44, req, body, { roles: CREATE_RUN_CASE, allowApiKey: false });
    const tenantId = auth.tenantId;
    const E = base44.asServiceRole.entities;
    const tenant = await loadTenant(base44, tenantId);
    if (!isKybEnabled(tenant)) throw httpError(403, 'Business verification is not enabled');
    if (!body.client_id || !body.related_party_id) throw httpError(400, 'client_id and related_party_id are required');

    const client = asList(await E.Client.filter({ tenant_id: tenantId, id: body.client_id }, undefined, 1))[0];
    if (!client) throw httpError(404, 'Client not found');
    if (client.client_type !== 'ORG') throw httpError(400, 'Key-person verification is for organisation clients');
    const link = asList(await E.ClientRelatedPartyLink.filter({ tenant_id: tenantId, client_id: client.id, related_party_id: body.related_party_id }, undefined, 1))[0];
    if (!link) throw httpError(404, 'This person is not linked to the client');
    const rp = asList(await E.RelatedParty.filter({ tenant_id: tenantId, id: body.related_party_id }, undefined, 1))[0];
    if (!rp) throw httpError(404, 'Related party not found');
    if (rp.party_type === 'ORG') throw httpError(400, 'Identity verification is for natural persons; verify a corporate owner with business verification');
    await assertClientNotLocked(base44, tenantId, client.id);

    let caseId = null;
    if (body.kyc_case_id) {
      const kc = asList(await E.KycCase.filter({ tenant_id: tenantId, id: body.kyc_case_id }, undefined, 1))[0];
      if (!kc || kc.client_id !== client.id) throw httpError(404, 'Case not found');
      caseId = kc.id;
    }
    const email = String(body.email || '').trim();
    if (email && !EMAIL.test(email)) throw httpError(400, 'Invalid email address');
    // Optional Didit workflow chosen in the case; only a KYC workflow of this tenant is accepted (else the default applies).
    const wfId = body.workflow_id ? pickWorkflow(tenant, 'kyc', String(body.workflow_id)) : '';
    const workflow = wfId && wfId === body.workflow_id
      ? { idv_workflow_id: wfId, idv_workflow_name: parseWorkflows(tenant).find((w) => w.workflow_id === wfId)?.name || '' }
      : null;

    // One open request per person: reuse it instead of creating a duplicate.
    const open = asList(await E.OutreachRequest.filter({ tenant_id: tenantId, client_id: client.id, related_party_id: rp.id }, '-created_date', 5))
      .find((r) => !['Complete', 'Cancelled'].includes(r.status) && (!r.token_expires_at || new Date(r.token_expires_at).getTime() > Date.now()));
    if (open) {
      const patch: Record<string, unknown> = {};
      if (email && email !== open.recipient_email) patch.recipient_email = email;
      // A newly chosen workflow applies only while the person has not started their session.
      if (workflow && (open.items || []).some((i) => i.field_type === 'id_verification' && !i.didit_session_id && i.idv_workflow_id !== workflow.idv_workflow_id)) {
        patch.items = (open.items || []).map((i) => (i.field_type === 'id_verification' && !i.didit_session_id ? { ...i, ...workflow } : i));
      }
      if (Object.keys(patch).length) await E.OutreachRequest.update(open.id, patch);
      return Response.json({ ok: true, reused: true, outreach_id: open.id, access_token: open.access_token, recipient_email: email || open.recipient_email || null });
    }

    const rnd = () => crypto.randomUUID().replace(/-/g, '');
    const deadline = new Date(Date.now() + 14 * 86400000);
    const expires = new Date(deadline.getTime() + 8 * 86400000);
    const item = {
      item_id: crypto.randomUUID(), sort_order: 0, item_type: 'data_point', field_type: 'id_verification', status: 'Requested',
      label: `Identity verification — ${rp.full_name}`,
      description: `As ${link.role || rp.role_in_relationship || 'a key person'} of ${client.full_name}, please verify your identity.`,
      idv_accepted_doc_types: ['Passport', 'Driving_Licence', 'National_ID'], idv_min_match_score: 75, idv_liveness_required: true, idv_auto_proceed: false, idv_workflow_id: '',
      ...(workflow || {}),
      validation_required: true,
    };
    const req2 = await E.OutreachRequest.create({
      tenant_id: tenantId, client_id: client.id, case_id: caseId || undefined, standalone: !caseId, related_party_id: rp.id,
      recipient_email: email || undefined, message: `Identity verification for ${rp.full_name} (${client.full_name})`,
      deadline: deadline.toISOString().slice(0, 10), delivery_channel: 'Portal', status: 'Sent',
      access_token: `${rnd()}${rnd().slice(0, 8)}`, token_expires_at: expires.toISOString(), items: [item],
    });
    if (rp.verification_status !== 'Verified') await E.RelatedParty.update(rp.id, { verification_status: 'Pending_Verification' });
    await E.AuditEvent.create({
      tenant_id: tenantId, client_id: client.id, case_id: caseId || undefined, actor_user_id: auth.actorUserId, actor_name: auth.actorName,
      actor_type: 'User', event_type: 'key_person_idv_requested', before_state: { verification_status: rp.verification_status || null },
      after_state: { related_party_id: rp.id, outreach_id: req2.id, recipient_email: email ? `${email.slice(0, 2)}…@${email.split('@')[1]}` : null },
      notes: `Identity verification requested for ${rp.full_name} (${link.role || rp.role_in_relationship || 'related party'}) of ${client.full_name}.`,
    });
    return Response.json({ ok: true, outreach_id: req2.id, access_token: req2.access_token, recipient_email: email || null });
  } catch (error) {
    console.error('sendKeyPersonIdv error:', error?.message);
    return errorResponse(error);
  }
}
