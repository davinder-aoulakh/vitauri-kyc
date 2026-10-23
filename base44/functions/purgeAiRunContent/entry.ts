// purgeAiRunContent — blanks the stored prompt and output (prompt_redacted, output_full) of AI runs whose
// retain_until date has passed. The run record itself, its prompt hash, summary and analyst action stay.
// Runs linked to a TM case or alert of a client with an open TM case are kept until the case closes.
// Auth: scheduled (no user) -> all tenants; signed-in Compliance Admin / Tenant Admin -> own tenant only.
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.52';
import { writeAudit } from '../../shared/tmAudit.js';
import { asList, errorResponse, httpError } from '../../shared/tmAuth.js';

const ADMIN_ROLES = ['Compliance Admin', 'Tenant Admin'];
const BATCH = 200;
const OPEN_CASE = ['open', 'investigating', 'pending_co'];

export default async function (req) {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me().catch(() => null);
    let onlyTenant = null;
    if (user && user.role !== 'admin') {
      const role = user.app_role || user.data?.app_role;
      if (!ADMIN_ROLES.includes(role)) throw httpError(403, 'Forbidden');
      onlyTenant = user.tenant_id || user.data?.tenant_id;
      if (!onlyTenant) throw httpError(403, 'No tenant associated with this user');
    }
    const E = base44.asServiceRole.entities;
    const today = new Date().toISOString().slice(0, 10);
    const now = new Date().toISOString();
    const tenants = asList(await E.Tenant.list('-created_date', 1000)).filter((t) => !onlyTenant || t.id === onlyTenant);
    const results = [];

    for (const tenant of tenants) {
      const openCases = asList(await E.TmCase.filter({ tenant_id: tenant.id, status: { $in: OPEN_CASE } }, undefined, 1000));
      const keepCases = new Set(openCases.map((c) => c.id));
      const keepAlerts = new Set(openCases.flatMap((c) => c.alert_ids || []));
      let purged = 0;
      let kept = 0;
      for (let round = 0; round < 50; round++) {
        const due = asList(await E.AiAgentRun.filter({
          tenant_id: tenant.id, retain_until: { $lt: today }, content_purged_at: { $exists: false },
        }, undefined, BATCH));
        const todo = due.filter((r) => !(r.tm_case_id && keepCases.has(r.tm_case_id)) && !(r.tm_alert_id && keepAlerts.has(r.tm_alert_id)));
        kept += due.length - todo.length;
        for (const r of todo) {
          await E.AiAgentRun.update(r.id, { prompt_redacted: '', output_full: '', content_purged_at: now });
          purged++;
        }
        if (due.length < BATCH || todo.length === 0) break;
      }
      if (purged > 0) {
        await writeAudit(base44, { actorUserId: user?.id || 'system', actorName: user?.full_name || 'Retention job', actorType: user ? 'User' : 'System' }, {
          tenantId: tenant.id, eventType: 'ai_run_content_purged',
          after: { purged, kept_for_open_cases: kept, before: today },
          notes: `Stored AI prompts and outputs past their retention date were blanked for ${purged} run(s); hashes and summaries are kept.`,
        });
      }
      results.push({ tenant_id: tenant.id, purged, kept_for_open_cases: kept });
    }
    return Response.json({ ok: true, results });
  } catch (error) {
    return errorResponse(error);
  }
}
