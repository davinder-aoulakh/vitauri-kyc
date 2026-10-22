// createDiditKybSession — start (or resume) a Didit Business Verification (KYB) session for a kyb_verification outreach item.
// Auth: the client-portal access token (no Vitauri login). Tenant, client and outreach come from the token's OutreachRequest,
// never from the browser. vendor_data = the organisation client id. Requires the didit_kyb feature.
// Didit reuses an unfinished session for the same vendor_data on the same workflow version (idempotent).
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.52';
import { asList, errorResponse, httpError, loadTenantWithDiditCredentials } from '../../shared/tmAuth.js';
import { pickWorkflow, isKybEnabled } from '../../shared/diditWorkflows.js';

const API = 'https://verification.didit.me';
const REGISTRY_COUNTRY = /^[A-Z]{2}(-[A-Z0-9]{1,3})?$/;

export default async function (req) {
  try {
    const base44 = createClientFromRequest(req);
    const body = await req.json().catch(() => ({}));
    const E = base44.asServiceRole.entities;
    const token = String(body.access_token || '');
    if (!token || !body.item_id) throw httpError(400, 'access_token and item_id are required');

    const outreach = asList(await E.OutreachRequest.filter({ access_token: token }, undefined, 1))[0];
    if (!outreach) throw httpError(404, 'Request not found');
    if (outreach.token_expires_at && new Date(outreach.token_expires_at).getTime() < Date.now()) throw httpError(410, 'This link has expired');
    if (body.outreach_id && body.outreach_id !== outreach.id) throw httpError(403, 'Request does not match this link');
    const item = (outreach.items || []).find((i) => i.item_id === body.item_id);
    if (!item) throw httpError(404, 'Item not found');
    const tmpl = item.field_type ? null : asList(await E.OutreachTemplate.filter({ tenant_id: outreach.tenant_id, id: item.item_id }, undefined, 1))[0];
    if ((item.field_type || tmpl?.field_type) !== 'kyb_verification') throw httpError(400, 'This item is not a business verification');

    const tenant = await loadTenantWithDiditCredentials(base44, outreach.tenant_id);
    if (!isKybEnabled(tenant)) throw httpError(403, 'Business verification is not enabled for this institution');
    if (!tenant.didit_api_key) throw httpError(412, 'Business verification is not configured for this institution. Contact support.');
    const client = asList(await E.Client.filter({ tenant_id: tenant.id, id: outreach.client_id }, undefined, 1))[0];
    if (!client) throw httpError(404, 'Client not found');
    if (client.client_type !== 'ORG') throw httpError(400, 'Business verification is only available for organisations');

    const workflowId = pickWorkflow(tenant, 'kyb', item.idv_workflow_id || tmpl?.idv_workflow_id);
    if (!workflowId) throw httpError(412, 'No Didit KYB workflow is configured. Ask your administrator.');

    // Reuse the existing record for this item; Didit returns the same unfinished session for the same vendor_data.
    let kyb = asList(await E.KybVerification.filter({ tenant_id: tenant.id, outreach_id: outreach.id, item_id: item.item_id }, '-created_date', 1))[0] || null;
    const finished = ['Approved', 'Declined', 'In Review'];
    if (kyb?.didit_session_url && kyb.status && !finished.includes(kyb.status) && !['Expired', 'Abandoned'].includes(kyb.status)) {
      return Response.json({ ok: true, session_url: kyb.didit_session_url, kyb_verification_id: kyb.id, status: kyb.status, resumed: true });
    }

    const portalUrl = String(body.portal_url || '').startsWith('https://') ? String(body.portal_url) : '';
    const country = String(client.registered_country || '').toUpperCase();
    const expected = {
      ...(client.full_name ? { company_name: client.full_name } : {}),
      ...(REGISTRY_COUNTRY.test(country) ? { registry_country: country } : {}),
      ...(client.registration_number ? { registration_number: String(client.registration_number) } : {}),
    };
    const payload: Record<string, unknown> = {
      workflow_id: workflowId,
      vendor_data: client.id,
      callback_method: 'both',
      language: String(body.language || 'en').slice(0, 5),
      metadata: { tenant_id: tenant.id, outreach_id: outreach.id, item_id: item.item_id, kind: 'kyb', platform: 'vitauri_kyc' },
      ...(portalUrl ? { callback: `${portalUrl}?didit_kyb_done=1&outreach_id=${outreach.id}&item_id=${encodeURIComponent(item.item_id)}` } : {}),
      ...(Object.keys(expected).length ? { expected_details: expected } : {}),
      ...(client.primary_contact_email ? { contact_details: { email: client.primary_contact_email, send_notification_emails: false } } : {}),
    };

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 20000);
    let session;
    try {
      const res = await fetch(`${API}/v3/session/`, {
        method: 'POST', headers: { 'x-api-key': tenant.didit_api_key, 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(payload), signal: ctrl.signal,
      });
      session = await res.json().catch(() => ({}));
      if (!res.ok) throw httpError(502, session?.detail || session?.workflow_id?.[0] || `Didit error ${res.status}`);
    } finally {
      clearTimeout(timer);
    }

    const fields = {
      tenant_id: tenant.id, client_id: client.id, outreach_id: outreach.id, item_id: item.item_id, kyc_case_id: outreach.case_id || undefined,
      workflow_id: workflowId, didit_session_id: session.session_id, didit_session_url: session.url,
      status: session.status || 'Not Started',
    };
    if (kyb && kyb.didit_session_id === session.session_id) await E.KybVerification.update(kyb.id, fields);
    else kyb = await E.KybVerification.create(fields);

    const items = (outreach.items || []).map((i) => (i.item_id === item.item_id ? { ...i, kyb_verification_id: kyb.id, kyb_status: fields.status } : i));
    await E.OutreachRequest.update(outreach.id, { items });
    await E.AuditEvent.create({
      tenant_id: tenant.id, client_id: client.id, case_id: outreach.case_id || undefined, actor_type: 'Client', actor_name: 'Client portal',
      event_type: 'kyb_session_created', before_state: {}, after_state: { kyb_verification_id: kyb.id, didit_session_id: session.session_id, workflow_id: workflowId },
      notes: `Didit business verification session started for ${client.full_name}.`,
    });
    return Response.json({ ok: true, session_url: session.url, kyb_verification_id: kyb.id, status: fields.status });
  } catch (error) {
    console.error('createDiditKybSession error:', error?.message || error?.detail);
    return errorResponse(error?.status ? error : { status: 500, message: error?.detail || error?.message });
  }
}
