// linkCounterparty — link a counterparty to a related party (UBO, director, related company) and/or to a tenant customer,
// or remove the link. Users with tmWorkCase. Reversible; every change is recorded in link_history and an AuditEvent.
//   link   { counterparty_id, related_party_id?, client_id?, reason }
//   unlink { counterparty_id, reason }
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.52';
import { isTmEnabled } from '../../shared/tmGuards.js';
import { writeAudit } from '../../shared/tmAudit.js';
import { authenticate, errorResponse, httpError, loadTenant, asList, WORK_ROLES } from '../../shared/tmAuth.js';

export default async function (req) {
  try {
    const base44 = createClientFromRequest(req);
    const body = await req.json();
    const auth = await authenticate(base44, req, body, { roles: WORK_ROLES, allowApiKey: false });
    const tenantId = auth.tenantId;
    const tenant = await loadTenant(base44, tenantId);
    if (!isTmEnabled(tenant, 'tm_core')) throw httpError(403, 'Feature tm_core is not enabled');
    const E = base44.asServiceRole.entities;

    const action = body.action === 'unlink' ? 'unlink' : 'link';
    const reason = String(body.reason || '').trim();
    if (reason.length < 5) throw httpError(400, 'A reason is required');
    const cp = asList(await E.Counterparty.filter({ tenant_id: tenantId, id: body.counterparty_id }, undefined, 1))[0];
    if (!cp) throw httpError(404, 'Counterparty not found');

    let patch;
    if (action === 'link') {
      if (!body.related_party_id && !body.client_id) throw httpError(400, 'related_party_id or client_id is required');
      if (body.related_party_id) {
        const rp = asList(await E.RelatedParty.filter({ tenant_id: tenantId, id: body.related_party_id }, undefined, 1))[0];
        if (!rp) throw httpError(404, 'Related party not found');
      }
      if (body.client_id) {
        const c = asList(await E.Client.filter({ tenant_id: tenantId, id: body.client_id }, undefined, 1))[0];
        if (!c) throw httpError(404, 'Customer not found');
      }
      patch = { related_party_id: body.related_party_id || cp.related_party_id || null, client_id: body.client_id || cp.client_id || null };
    } else {
      patch = { related_party_id: null, client_id: null };
    }
    const entry = { action, related_party_id: patch.related_party_id, client_id: patch.client_id, by_user_id: auth.actorUserId, by_name: auth.actorName, at: new Date().toISOString(), reason };
    await E.Counterparty.update(cp.id, { ...patch, link_history: [...(cp.link_history || []), entry] });
    await writeAudit(base44, auth, {
      tenantId, eventType: action === 'link' ? 'counterparty_linked' : 'counterparty_unlinked',
      before: { counterparty_id: cp.id, related_party_id: cp.related_party_id || null, client_id: cp.client_id || null },
      after: { counterparty_id: cp.id, ...patch },
      notes: `Counterparty "${cp.display_name}" ${action === 'link' ? 'linked' : 'unlinked'} by ${auth.actorName}: ${reason}`,
    });
    return Response.json({ ok: true, counterparty_id: cp.id, ...patch });
  } catch (error) {
    return errorResponse(error);
  }
}
