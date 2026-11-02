// scanFiuProposals — daily (and on demand from FIU Reports): proposes draft CTR / TTR / IFT / CBR reports from the FIU profile
// thresholds and TFR reports from terrorist-financing signals. Drafts only; a person reviews each one and four-eyes approval applies.
// Auth: scheduled run (no user: every tenant with tm_core + tm_fiu), or a signed-in user of the tenant (own tenant only)
// with tmWorkCase / Compliance Admin / Tenant Admin. Body: { days?: 1-31 (default 3) }.
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.52';
import { isTmEnabled } from '../../shared/tmGuards.js';
import { asList, errorResponse, httpError, WORK_ROLES } from '../../shared/tmAuth.js';
import { fetchAll } from '../../shared/tmCoverage.js';
import { tenantUsers, roleOf, CO_ROLES, OPEN_ALERT } from '../../shared/tmCaseCommon.js';
import { writeAudit } from '../../shared/tmAudit.js';
import { resolveProfileCode } from '../../shared/tmFiuMap.js';
import { prepareReport } from '../../shared/tmFiuPrepare.js';
import { detectThresholdProposals, detectTfProposals, reportedKeys } from '../../shared/tmFiuProposals.js';

const CALLER_ROLES = [...WORK_ROLES, 'Compliance Admin', 'Tenant Admin', 'Vitauri Ops'];
const MAX_PER_RUN = 50;

async function processTenant(base44, tenant, { days, actor }) {
  const E = base44.asServiceRole.entities;
  const tenantId = tenant.id;
  const auth = actor || { mode: 'system', tenantId, actorType: 'System', actorName: 'FIU report proposals', actorUserId: undefined };
  const ctx = { base44, E, auth: { ...auth, tenantId }, tenantId, tenant };
  const cur = tenant.tm_reporting_currency || 'USD';
  const profiles = asList(await E.FiuProfile.filter({ tenant_id: tenantId }, undefined, 10));
  if (!profiles.length) return { tenant_id: tenantId, skipped: 'No FIU profile' };
  const byCode = Object.fromEntries(profiles.map((p) => [p.code, p]));

  const earlier = await fetchAll((cursor) => E.FiuReport.filter({ tenant_id: tenantId, origin: { $in: ['auto_threshold', 'auto_tf'] } }, { sort: '-created_date', limit: 500, cursor }), 4);
  const reported = reportedKeys(earlier);

  // Threshold proposals over the window.
  const since = new Date(Date.now() - days * 86400000).toISOString();
  const txns = await fetchAll((cursor) => E.Transaction.filter({ tenant_id: tenantId, executed_at: { $gte: since } }, { sort: 'executed_at', limit: 500, cursor }), 20);
  const clientIds = [...new Set(txns.map((t) => t.client_id).filter(Boolean))];
  const clients = [];
  for (let i = 0; i < clientIds.length; i += 200) clients.push(...asList(await E.Client.filter({ tenant_id: tenantId, id: { $in: clientIds.slice(i, i + 200) } }, undefined, 200)));
  const proposals = [];
  let unknownAmount = 0;
  for (const client of clients) {
    const fiu = byCode[resolveProfileCode(client)] || profiles[0];
    const res = detectThresholdProposals({ client, fiu, txns: txns.filter((t) => t.client_id === client.id), cur, reported });
    unknownAmount += res.unknownAmount;
    proposals.push(...res.proposals.map((p) => ({ ...p, profile_code: fiu.code })));
  }

  // TFR proposals.
  const tfEnabled = profiles.some((p) => !(p.enabled_report_types || []).length || p.enabled_report_types.includes('TFR'));
  if (tfEnabled) {
    const [hits, alerts, scenarios] = await Promise.all([
      E.ScreeningHit.filter({ tenant_id: tenantId, status: { $in: ['Confirmed_Match', 'Escalated'] } }, '-created_date', 500).then(asList),
      E.TmAlert.filter({ tenant_id: tenantId, status: { $in: OPEN_ALERT } }, '-created_date', 500).then(asList),
      E.TmScenario.filter({ tenant_id: tenantId }, undefined, 1000).then(asList),
    ]);
    proposals.push(...detectTfProposals({ hits, alerts, scenarios, reported }));
  }

  // TFR first (without delay), then oldest date first.
  proposals.sort((a, b) => (a.type === 'TFR' ? -1 : b.type === 'TFR' ? 1 : String(a.date).localeCompare(String(b.date))));
  const created = [];
  const failed = [];
  for (const p of proposals.slice(0, MAX_PER_RUN)) {
    try {
      const r = await prepareReport(ctx, {
        clientId: p.client_id, reportType: p.type, transactionIds: p.transaction_ids || [], alertIds: p.alert_ids || [],
        profileCode: p.profile_code, origin: p.type === 'TFR' ? 'auto_tf' : 'auto_threshold', narrativeText: p.narrative,
        priority: p.type === 'TFR' ? 'without_delay' : 'normal', freezeAdvised: p.type === 'TFR' ? true : undefined,
        proposal: { key: p.key, signal_keys: p.signal_keys, rule: p.rule, date: p.date, total: p.total, threshold: p.threshold, currency: p.currency, proposed_at: new Date().toISOString() },
      });
      created.push({ report_id: r.report_id, report_ref: r.report_ref, type: p.type, client_id: p.client_id });
    } catch (e) {
      failed.push({ key: p.key, error: String(e?.message || e).slice(0, 200) });
    }
  }

  if (created.length) {
    const users = (await tenantUsers(E, tenantId)).filter((u) => [...CO_ROLES, 'Manager', 'Compliance Admin'].includes(roleOf(u)));
    const tfr = created.filter((c) => c.type === 'TFR').length;
    const day = new Date().toISOString().slice(0, 10);
    if (users.length) {
      await E.Notification.bulkCreate(users.map((u) => ({
        tenant_id: tenantId, user_id: u.id, type: 'fiu_report_review',
        title: tfr ? `${tfr} terrorist-financing report(s) to file without delay` : `${created.length} FIU report proposal(s) to review`,
        body: created.map((c) => `${c.report_ref} (${c.type})`).join(', ').slice(0, 500),
        link_fiu_report_id: created[0].report_id, dedupe_key: `${u.id}:fiu_proposals:${day}:${created.map((c) => c.report_id).join(',').slice(0, 120)}`,
      }))).catch((e) => console.warn('proposal notifications failed:', e?.message));
    }
    await writeAudit(base44, ctx.auth, {
      tenantId, eventType: 'fiu_reports_proposed', before: {},
      after: { created: created.map((c) => ({ report_ref: c.report_ref, type: c.type })), failed: failed.length, window_days: days, transactions_without_reporting_amount: unknownAmount },
      notes: `${created.length} FIU report proposal(s) created (${[...new Set(created.map((c) => c.type))].join(', ')}).`,
    });
  }
  return { tenant_id: tenantId, proposed: proposals.length, created, failed, capped: proposals.length > MAX_PER_RUN, transactions_without_reporting_amount: unknownAmount };
}

export default async function (req) {
  try {
    const base44 = createClientFromRequest(req);
    const body = await req.json().catch(() => ({}));
    const days = Math.min(31, Math.max(1, Number(body.days) || 3));
    const user = await base44.auth.me().catch(() => null);
    let onlyTenant = null;
    let actor = null;
    if (user) {
      const role = roleOf(user);
      if (!CALLER_ROLES.includes(role)) throw httpError(403, 'Forbidden');
      onlyTenant = user.tenant_id || user.data?.tenant_id;
      if (!onlyTenant) throw httpError(403, 'No tenant associated with this user');
      actor = { mode: 'user', tenantId: onlyTenant, actorType: 'User', actorName: user.full_name || user.email, actorUserId: undefined, requestedBy: user.id };
    }
    const tenants = asList(await base44.asServiceRole.entities.Tenant.list('-created_date', 1000))
      .filter((t) => t.status !== 'Suspended' && isTmEnabled(t, 'tm_core') && isTmEnabled(t, 'tm_fiu') && (!onlyTenant || t.id === onlyTenant));
    const results = [];
    for (const tenant of tenants) {
      try { results.push(await processTenant(base44, tenant, { days, actor })); } catch (e) {
        results.push({ tenant_id: tenant.id, error: String(e?.message || e).slice(0, 300) });
      }
    }
    return Response.json({ ok: true, tenants: results.length, results });
  } catch (error) {
    console.error('scanFiuProposals error:', error?.message);
    return errorResponse(error);
  }
}
