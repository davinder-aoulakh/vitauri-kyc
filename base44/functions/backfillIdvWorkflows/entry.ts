// backfillIdvWorkflows — repairs outreach requests created by the case outreach step before it copied the Didit
// workflow: identity-verification items that are still Requested, have no Didit session yet and no idv_workflow_id
// get the workflow set on their library field (OutreachTemplate with id = item_id). Started sessions are never touched.
//   { dry_run?: boolean (default true), tenant_id?: string (Vitauri Ops only) }
// Auth: Vitauri Ops (any tenant) or Tenant Admin (own tenant).
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.52';
import { writeAudit } from '../../shared/tmAudit.js';
import { pickWorkflow } from '../../shared/diditWorkflows.js';
import { fetchAll } from '../../shared/tmCoverage.js';
import { asList, errorResponse, httpError } from '../../shared/tmAuth.js';

export default async function (req) {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me().catch(() => null);
    if (!user) throw httpError(401, 'Unauthorized');
    const role = user.app_role || user.data?.app_role;
    const body = await req.json().catch(() => ({}));
    const isOps = role === 'Vitauri Ops';
    if (!isOps && role !== 'Tenant Admin') throw httpError(403, 'Forbidden');
    const tenantId = isOps && body.tenant_id ? body.tenant_id : (user.tenant_id || user.data?.tenant_id);
    if (!tenantId) throw httpError(400, 'No tenant resolved');
    const dryRun = body.dry_run !== false;

    const E = base44.asServiceRole.entities;
    const tenant = asList(await E.Tenant.filter({ id: tenantId }, undefined, 1))[0];
    if (!tenant) throw httpError(404, 'Tenant not found');
    const templates = asList(await E.OutreachTemplate.filter({ tenant_id: tenantId, field_type: 'id_verification' }, undefined, 500));
    const byId = new Map(templates.map((t) => [t.id, t]));
    const requests = await fetchAll((cursor) => E.OutreachRequest.filter({ tenant_id: tenantId, status: { $nin: ['Complete'] } }, { limit: 500, cursor }), 20);

    const changes = [];
    for (const r of requests) {
      let touched = false;
      const items = (r.items || []).map((it) => {
        if (it.field_type !== 'id_verification' || it.idv_workflow_id || it.didit_session_id || it.status !== 'Requested') return it;
        const tmpl = byId.get(it.item_id);
        // Only a workflow that is still one of the tenant's KYC workflows is copied.
        if (!tmpl?.idv_workflow_id || pickWorkflow(tenant, 'kyc', tmpl.idv_workflow_id) !== tmpl.idv_workflow_id) return it;
        touched = true;
        changes.push({ outreach_id: r.id, case_id: r.case_id || null, item_id: it.item_id, workflow: tmpl.idv_workflow_name || tmpl.idv_workflow_id });
        return { ...it, idv_workflow_id: tmpl.idv_workflow_id, idv_workflow_name: tmpl.idv_workflow_name || '' };
      });
      if (touched && !dryRun) await E.OutreachRequest.update(r.id, { items });
    }

    if (!dryRun && changes.length) {
      await writeAudit(base44, { actorUserId: user.id, actorName: user.full_name || user.email, actorType: 'User' }, {
        tenantId, eventType: 'idv_workflow_backfilled',
        after: { items_updated: changes.length, requests: [...new Set(changes.map((c) => c.outreach_id))] },
        notes: `Didit workflow copied from the library field onto ${changes.length} not-yet-started identity verification item(s).`,
      });
    }
    return Response.json({ ok: true, dry_run: dryRun, scanned_requests: requests.length, items_to_update: changes.length, changes });
  } catch (error) {
    return errorResponse(error);
  }
}
