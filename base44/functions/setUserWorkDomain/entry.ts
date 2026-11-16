// setUserWorkDomain — sets User.work_domain ('both' | 'kyc' | 'aml') for a user of the caller's tenant (phase 6).
// Auth: Tenant Admin only; tenant from the caller. The value is written with the service role and audited, so it
// does not depend on what a browser may write to a user record.
//   { user_id, work_domain } -> { ok, user_id, work_domain }
//   { action: 'backfill' }     -> every user of the tenant without a work_domain gets 'both' (needed before the
//                                 read rules of docs/kyc-aml/phase6-read-rules.md are applied) -> { ok, updated }
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.52';
import { authenticate, errorResponse, httpError, asList } from '../../shared/tmAuth.js';
import { writeAudit } from '../../shared/tmAudit.js';
import { WORK_DOMAINS, domainOf } from '../../shared/workDomain.js';

export default async function (req) {
  try {
    const base44 = createClientFromRequest(req);
    const body = await req.json();
    const auth = await authenticate(base44, req, body, { roles: ['Tenant Admin'], allowApiKey: false });
    const tenantId = auth.tenantId;
    if (body.action === 'backfill') {
      const E0 = base44.asServiceRole.entities;
      const all = asList(await E0.User.filter({ tenant_id: tenantId }, undefined, 1000)).filter((x) => (x.tenant_id || x.data?.tenant_id) === tenantId);
      const missing = all.filter((x) => !WORK_DOMAINS.includes(x.work_domain || x.data?.work_domain));
      for (const x of missing) await E0.User.update(x.id, { work_domain: 'both' });
      await writeAudit(base44, auth, {
        tenantId, eventType: 'user_work_domain_backfilled', before: { without_work_domain: missing.length }, after: { work_domain: 'both', user_ids: missing.map((x) => x.id) },
        notes: `Work domain set to "both" for ${missing.length} user(s) that had none, by ${auth.actorName}.`,
      });
      return Response.json({ ok: true, updated: missing.length, users: all.length });
    }
    if (!body.user_id) throw httpError(400, 'user_id is required');
    if (!WORK_DOMAINS.includes(body.work_domain)) throw httpError(400, `work_domain must be one of: ${WORK_DOMAINS.join(', ')}`);
    const E = base44.asServiceRole.entities;
    const target = asList(await E.User.filter({ id: body.user_id }, undefined, 1))[0];
    const targetTenant = target?.tenant_id || target?.data?.tenant_id;
    if (!target || targetTenant !== tenantId) throw httpError(404, 'User not found');
    const before = domainOf(target);
    await E.User.update(target.id, { work_domain: body.work_domain });
    await writeAudit(base44, auth, {
      tenantId, eventType: 'user_work_domain_changed',
      before: { user_id: target.id, work_domain: before }, after: { user_id: target.id, work_domain: body.work_domain },
      notes: `Work domain of ${target.full_name || target.email || target.id} changed from ${before} to ${body.work_domain} by ${auth.actorName}.`,
    });
    return Response.json({ ok: true, user_id: target.id, work_domain: body.work_domain });
  } catch (error) {
    console.error('setUserWorkDomain error:', error?.message);
    return errorResponse(error);
  }
}
