// getMyWork — one role-aware work queue for the signed-in user: TM alerts and cases, KYC cases and sign-offs,
// EDR proposals, expected profiles awaiting approval, FIU reports and outreach replies. Read-only, own tenant only.
// Items: { kind, id, ref, title, subtitle, client_id, client_name, due_at, status, reason }. Routes are built in the app.
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.52';
import { isTmEnabled } from '../../shared/tmGuards.js';
import { asList, errorResponse, httpError, loadTenant } from '../../shared/tmAuth.js';
import { canDecideProfile } from '../../shared/tmProfileAuth.js';

const WORK_ROLES = ['Analyst', 'QC Reviewer', 'Compliance Officer', 'Manager'];
const FOUR_EYES_ROLES = ['QC Reviewer', 'Compliance Officer', 'Manager', 'Director'];
const EDR_ROLES = [...WORK_ROLES, 'Director'];
const VIEW_ALL_ROLES = ['QC Reviewer', 'Compliance Officer', 'Manager', 'Director', 'Compliance Admin', 'Tenant Admin'];
const OPEN_ALERT = ['new', 'triaged', 'in_review', 'escalated'];
const OPEN_CASE = ['open', 'investigating', 'pending_co', 'decided_report'];
const OPEN_KYC = ['Draft', 'In_Progress', 'Outreach_Pending', 'Screening', 'Assessment', 'QC', 'Compliance_Review', 'Sign_Off_Pending'];
const DAY = 86400000;

const label = (s) => String(s || '').replace(/_/g, ' ');

export default async function (req) {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me().catch(() => null);
    if (!user) throw httpError(401, 'Unauthorized');
    const tenantId = user.tenant_id || user.data?.tenant_id;
    if (!tenantId) throw httpError(403, 'No tenant associated with this user');
    const role = user.app_role || user.data?.app_role;
    const me = user.id;
    const tenant = await loadTenant(base44, tenantId);
    const E = base44.asServiceRole.entities;
    const tm = isTmEnabled(tenant, 'tm_core');
    const fiuOn = tm && isTmEnabled(tenant, 'tm_fiu');
    const now = Date.now();
    const seeAll = VIEW_ALL_ROLES.includes(role);

    const safe = (p) => p.then(asList).catch(() => []);
    const [alerts, cases, kyc, edr, profiles, reports, outreach] = await Promise.all([
      tm ? safe(E.TmAlert.filter({ tenant_id: tenantId, status: { $in: OPEN_ALERT } }, 'due_at', 500)) : [],
      tm ? safe(E.TmCase.filter({ tenant_id: tenantId, status: { $in: OPEN_CASE } }, 'due_at', 300)) : [],
      safe(E.KycCase.filter({ tenant_id: tenantId, status: { $in: OPEN_KYC } }, 'due_date', 500)),
      tm && EDR_ROLES.includes(role) ? safe(E.EdrTrigger.filter({ tenant_id: tenantId, status: 'proposed' }, '-created_date', 200)) : [],
      tm ? safe(E.ExpectedProfile.filter({ tenant_id: tenantId, status: 'proposed' }, '-created_date', 200)) : [],
      fiuOn ? safe(E.FiuReport.filter({ tenant_id: tenantId, status: { $in: ['draft', 'in_review', 'approved', 'generated', 'submitted'] } }, '-created_date', 200)) : [],
      safe(E.OutreachRequest.filter({ tenant_id: tenantId, status: { $in: ['Partial_Response', 'Complete'] }, updated_date: { $gte: new Date(now - 14 * DAY).toISOString() } }, '-updated_date', 200)),
    ]);

    // Customer names and analysts for everything referenced.
    const clientIds = [...new Set([...alerts, ...cases.map((c) => ({ client_id: c.primary_client_id })), ...kyc, ...edr, ...profiles, ...reports, ...outreach]
      .map((x) => x.client_id).filter(Boolean))];
    const clients = clientIds.length ? await safe(E.Client.filter({ tenant_id: tenantId, id: { $in: clientIds } }, undefined, clientIds.length)) : [];
    const clientById = new Map(clients.map((c) => [c.id, c]));
    const cname = (id) => clientById.get(id)?.full_name || 'Customer';
    const myClient = (id) => clientById.get(id)?.assigned_analyst_id === me;
    const myKycIds = new Set(kyc.filter((k) => k.assigned_analyst_id === me).map((k) => k.id));

    const items = [];
    const push = (it) => items.push({ ...it, client_name: it.client_id ? cname(it.client_id) : null });

    for (const a of alerts) {
      const mine = a.assigned_to_user_id === me;
      const unassignedForMe = !a.assigned_to_user_id && WORK_ROLES.includes(role) && (seeAll || myClient(a.client_id));
      if (!mine && !unassignedForMe) continue;
      push({ kind: 'alert', id: a.id, ref: a.ref || null, title: a.title || 'TM alert', subtitle: mine ? 'Assigned to you' : 'Unassigned', client_id: a.client_id, due_at: a.due_at || null, status: a.status, score: a.score ?? null, reason: a.ai_proposal || null });
    }
    for (const c of cases) {
      const assignee = c.assigned_to_user_id === me;
      const reviewer = c.four_eyes_user_id === me && FOUR_EYES_ROLES.includes(role);
      const coDecision = c.status === 'pending_co' && role === 'Compliance Officer';
      if (!assignee && !reviewer && !coDecision) continue;
      push({ kind: 'tm_case', id: c.id, ref: c.case_ref || null, title: c.title || 'TM case', subtitle: coDecision ? 'Awaiting CO decision' : reviewer && !assignee ? 'Four-eyes review' : 'Assigned to you', client_id: c.primary_client_id, due_at: c.due_at || null, status: c.status });
    }
    for (const k of kyc) {
      const assignee = k.assigned_analyst_id === me;
      const signOff = k.status === 'Sign_Off_Pending' && canDecideProfile({ role, userId: me, tenant, riskClass: k.risk_classification, proposedBy: k.sign_off_submitted_by }).allowed;
      if (!assignee && !signOff) continue;
      push({ kind: 'kyc_case', id: k.id, ref: null, title: `${label(k.case_type)}${k.trigger_reason ? ` · ${String(k.trigger_reason).slice(0, 80)}` : ''}`, subtitle: signOff && !assignee ? 'Sign-off awaiting you' : label(k.status), client_id: k.client_id, due_at: k.due_date ? `${k.due_date}T23:59:59Z` : null, status: k.status });
    }
    for (const t of edr) {
      if (!seeAll && !myClient(t.client_id)) continue;
      push({ kind: 'edr', id: t.id, ref: null, title: `Event-driven review proposed · ${label(t.trigger_type)}`, subtitle: 'Accept or dismiss', client_id: t.client_id, due_at: null, status: t.status, trigger_type: t.trigger_type });
    }
    for (const p of profiles) {
      const risk = clientById.get(p.client_id)?.risk_classification;
      if (!canDecideProfile({ role, userId: me, tenant, riskClass: risk, proposedBy: p.proposed_by_user_id }).allowed) continue;
      push({ kind: 'profile', id: p.id, ref: `v${p.version ?? '?'}`, title: `Expected profile v${p.version ?? '?'} awaiting approval`, subtitle: p.proposed_by_name ? `Proposed by ${p.proposed_by_name}` : 'Proposed', client_id: p.client_id, due_at: null, status: p.status });
    }
    for (const r of reports) {
      const co = role === 'Compliance Officer';
      const preparer = r.prepared_by_user_id === me;
      const needs = r.status === 'in_review' ? (co ? 'Approve' : null)
        : ['approved', 'generated'].includes(r.status) ? (co || preparer ? 'Submit to the FIU and record evidence' : null)
          : r.status === 'submitted' ? (co || preparer ? 'Record FIU receipt' : null)
            : r.status === 'draft' && preparer ? 'Complete the draft' : null;
      if (!needs) continue;
      push({ kind: 'fiu_report', id: r.id, ref: r.report_ref || null, title: `FIU report · ${r.fiu_profile_code || ''}`.trim(), subtitle: needs, client_id: r.client_id, due_at: r.clock?.due_at || null, status: r.status });
    }
    for (const o of outreach) {
      if (!(o.case_id && myKycIds.has(o.case_id))) continue;
      push({ kind: 'outreach', id: o.id, ref: null, title: o.status === 'Complete' ? 'Customer completed the request' : 'Customer replied (partial)', subtitle: 'Review the response', client_id: o.client_id, due_at: null, status: o.status, kyc_case_id: o.case_id });
    }

    const dueMs = (i) => (i.due_at ? new Date(i.due_at).getTime() : Infinity);
    items.sort((a, b) => dueMs(a) - dueMs(b) || (b.score || 0) - (a.score || 0));
    const dueNow = items.filter((i) => dueMs(i) < now + DAY).length;
    return Response.json({ items, due_now: dueNow, generated_at: new Date(now).toISOString(), tm_enabled: tm });
  } catch (error) {
    return errorResponse(error);
  }
}
