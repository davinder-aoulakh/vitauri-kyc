// runOsintSearch — open-source research on a case's client, for the OSINT panel.
// Auth: signed-in user of the case's tenant (or Vitauri Ops). Body: { case_id, hints? }.
// Searches every name variant (incl. preferred name) with the identifiers we hold, separates namesakes from the subject,
// caches the result on KycCase.osint_cache and writes an AuditEvent.
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.52';
import { asList, errorResponse, httpError } from '../../shared/tmAuth.js';
import { runOsint } from '../../shared/osintSearch.js';

export default async function (req) {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) throw httpError(401, 'Unauthorized');
    let body: any = {};
    try { body = await req.json(); } catch { body = {}; }
    if (!body.case_id) throw httpError(400, 'case_id is required');

    const E = base44.asServiceRole.entities;
    const kycCase = asList(await E.KycCase.filter({ id: body.case_id }))[0];
    if (!kycCase) throw httpError(404, 'Case not found');
    const tenantId = user.tenant_id || user.data?.tenant_id;
    const role = user.app_role || user.data?.app_role;
    if (kycCase.tenant_id !== tenantId && role !== 'Vitauri Ops') throw httpError(403, 'Forbidden');
    const client = asList(await E.Client.filter({ id: kycCase.client_id }))[0];
    if (!client) throw httpError(404, 'Client not found');

    const hints = String(body.hints ?? '').slice(0, 500);
    const results = await runOsint(base44, { client, kycCase, hints });
    const runAt = new Date().toISOString();
    await E.KycCase.update(kycCase.id, { osint_cache: JSON.stringify({ results, run_at: runAt }) });
    await E.AuditEvent.create({
      tenant_id: kycCase.tenant_id, case_id: kycCase.id, client_id: client.id,
      actor_user_id: user.id, actor_name: user.full_name, actor_type: 'User', event_type: 'osint_search_run',
      before_state: {},
      after_state: { names: results.subject.names, findings: results.findings.length, other_people: results.other_people.length, adverse: results.adverse_count },
      notes: `OSINT search run as: ${results.subject.names.join(', ')}. ${results.findings.length} finding(s) about the subject, ${results.other_people.length} namesake(s) set aside.`,
    });
    return Response.json({ ok: true, results, run_at: runAt });
  } catch (error) {
    console.error('runOsintSearch error:', error?.message);
    return errorResponse(error);
  }
}
