// tmRetentionDigest — monthly (1st, 01:00 UTC) COUNT of TM records past the tenant's retention period.
// NEVER deletes or changes any TM record. Per tenant with tm_core on it sends one Notification and one email
// (internal recipients only: that tenant's own Compliance Admin users) with counts per entity.
// Not counted: records of clients that have an open TmCase or a FiuReport younger than the retention period,
// open cases, and AI runs linked to those cases/alerts.
// Auth: scheduled (no user) -> all tenants; signed-in Compliance Admin / Tenant Admin -> own tenant only.
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.52';
import { isTmEnabled } from '../../shared/tmGuards.js';
import { asList, chunk, errorResponse, httpError } from '../../shared/tmAuth.js';

const ADMIN_ROLES = ['Compliance Admin', 'Tenant Admin'];
const TM_AGENTS = ['TmTriage', 'TmEvidence', 'TmNarrative', 'TmRuleDraft'];
const ENTITIES = [['Transaction', 'Transactions'], ['TmAlert', 'Alerts'], ['TmCase', 'Cases'], ['FiuReport', 'FIU reports'], ['StatementUpload', 'Statement uploads'], ['CoverageDay', 'Coverage days'], ['AiAgentRun', 'AI agent runs']];
const DAY_MS = 86400000;

async function pageAll(fetchPage) {
  const out = [];
  let cursor;
  for (let i = 0; i < 200; i++) {
    const page = await fetchPage(cursor);
    out.push(...(page?.items || []));
    if (!page?.has_more || !page?.next_cursor) break;
    cursor = page.next_cursor;
  }
  return out;
}

async function countsFor(E, tenant) {
  const tid = tenant.id;
  const years = Number(tenant.audit_retention_years) || 5;
  const cutoffDate = new Date();
  cutoffDate.setFullYear(cutoffDate.getFullYear() - years);
  const cutoff = cutoffDate.toISOString();

  // What is still needed: open cases, FIU reports younger than the retention period, and what they link to.
  const openCases = await pageAll((cursor) => E.TmCase.filter({ tenant_id: tid, status: { $ne: 'closed' } }, { limit: 500, cursor }));
  const youngReports = await pageAll((cursor) => E.FiuReport.filter({ tenant_id: tid, created_date: { $gte: cutoff } }, { limit: 500, cursor }));
  const caseIds = new Set([...openCases.map((c) => c.id), ...youngReports.map((r) => r.tm_case_id).filter(Boolean)]);
  const alertIds = new Set([...openCases.flatMap((c) => c.alert_ids || []), ...youngReports.flatMap((r) => r.alert_ids || [])]);
  const clients = new Set([
    ...openCases.flatMap((c) => [c.primary_client_id, ...(c.client_ids || [])]), ...youngReports.map((r) => r.client_id),
  ].filter(Boolean));
  for (const g of chunk([...alertIds], 100)) {
    for (const a of asList(await E.TmAlert.filter({ tenant_id: tid, id: { $in: g } }, undefined, 100))) if (a.client_id) clients.add(a.client_id);
  }
  const pc = [...clients];
  const pCases = [...caseIds];
  const pAlerts = [...alertIds];
  const old = { tenant_id: tid, created_date: { $lt: cutoff } };

  const [transactions, alerts, cases, reports, statements, coverage, runs] = await Promise.all([
    E.Transaction.count({ ...old, client_id: { $nin: pc } }),
    E.TmAlert.count({ ...old, client_id: { $nin: pc } }),
    E.TmCase.count({ ...old, status: 'closed', primary_client_id: { $nin: pc } }),
    E.FiuReport.count({ ...old, client_id: { $nin: pc }, tm_case_id: { $nin: pCases } }),
    E.StatementUpload.count({ ...old, client_id: { $nin: pc } }),
    E.CoverageDay.count({ ...old, client_id: { $nin: pc } }),
    E.AiAgentRun.count({
      ...old, tm_case_id: { $nin: pCases }, tm_alert_id: { $nin: pAlerts },
      $or: [{ tm_case_id: { $exists: true } }, { tm_alert_id: { $exists: true } }, { agent_type: { $in: TM_AGENTS } }],
    }),
  ]);
  const counts = { Transaction: transactions, TmAlert: alerts, TmCase: cases, FiuReport: reports, StatementUpload: statements, CoverageDay: coverage, AiAgentRun: runs };
  return { counts, total: Object.values(counts).reduce((n, v) => n + (v || 0), 0), years, cutoff: cutoff.slice(0, 10), protectedClients: pc.length };
}

export default async function (req) {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me().catch(() => null);
    let onlyTenant = null;
    if (user) {
      const role = user.app_role || user.data?.app_role;
      if (!ADMIN_ROLES.includes(role)) throw httpError(403, 'Forbidden');
      onlyTenant = user.tenant_id || user.data?.tenant_id;
      if (!onlyTenant) throw httpError(403, 'No tenant associated with this user');
    }
    const E = base44.asServiceRole.entities;
    const tenants = asList(await E.Tenant.list('-created_date', 1000))
      .filter((t) => t.status === 'Active' && isTmEnabled(t, 'tm_core') && (!onlyTenant || t.id === onlyTenant));
    const users = asList(await E.User.list('-created_date', 5000));
    const results = [];

    for (const tenant of tenants) {
      try {
        // Scheduled runs: at most one digest per tenant per 20 days (guards against repeated unauthenticated calls).
        if (!user) {
          const since = new Date(Date.now() - 20 * DAY_MS).toISOString();
          const recent = asList(await E.AuditEvent.filter({ tenant_id: tenant.id, event_type: 'tm_retention_digest_sent', created_date: { $gte: since } }, undefined, 1));
          if (recent.length) { results.push({ tenant: tenant.name, skipped: 'recent digest' }); continue; }
        }
        const r = await countsFor(E, tenant);
        if (r.total === 0) { results.push({ tenant: tenant.name, eligible: 0 }); continue; }

        const lines = ENTITIES.map(([k, label]) => `• ${label}: ${r.counts[k]}`).join('\n');
        const recipients = users.filter((u) => (u.tenant_id || u.data?.tenant_id) === tenant.id && (u.app_role || u.data?.app_role) === 'Compliance Admin' && u.email);
        const title = `${r.total} transaction monitoring record(s) past the ${r.years}-year retention period`;
        for (const admin of recipients) {
          await E.Notification.create({
            tenant_id: tenant.id, user_id: admin.id, type: 'tm_retention_digest', title,
            body: ENTITIES.map(([k, label]) => `${label}: ${r.counts[k]}`).join(' · '), is_read: false,
          });
          await base44.asServiceRole.integrations.Core.SendEmail({
            to: admin.email,
            subject: `[Vitauri KYC] Transaction monitoring records past retention: ${tenant.name}`,
            body: `Dear ${admin.full_name || 'Compliance Administrator'},\n\nThese transaction monitoring records at ${tenant.name} were created before ${r.cutoff} (more than ${r.years} years ago) and are not tied to an open case or a recent FIU report:\n\n${lines}\n\nNothing has been deleted. Please review and decide on deletion or a documented retention extension.\n\nThis is an automated monthly digest. It covers ${tenant.name} only.`,
          });
        }
        await E.AuditEvent.create({
          tenant_id: tenant.id, actor_type: 'System', actor_name: 'TM Retention Digest', event_type: 'tm_retention_digest_sent',
          before_state: {}, after_state: { counts: r.counts, total: r.total, cutoff: r.cutoff, recipients: recipients.length },
          notes: `TM retention digest: ${r.total} record(s) past ${r.years} years; sent to ${recipients.length} Compliance Admin(s). Nothing deleted.`,
        });
        results.push({ tenant: tenant.name, eligible: r.total, recipients: recipients.length });
      } catch (e) {
        results.push({ tenant: tenant.name, error: String(e?.message || e).slice(0, 200) });
      }
    }
    return Response.json({ processed: tenants.length, results, run_at: new Date().toISOString() });
  } catch (error) {
    console.error('tmRetentionDigest error:', error?.message);
    return errorResponse(error);
  }
}