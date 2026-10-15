// Shared helpers for the TM investigation case (manageTmCase).
import { asList, httpError } from './tmAuth.js';
import { writeAudit } from './tmAudit.js';
import { caseClock, loadFiuProfile } from './tmDeadline.js';
import { assertClientNotLocked } from './tippingOff.js';

export const OPEN_CASE = ['open', 'investigating', 'pending_co'];
export const WORKABLE_CASE = ['open', 'investigating'];
export const OPEN_ALERT = ['new', 'triaged', 'in_review'];
export const FOUR_EYES_ROLES = ['QC Reviewer', 'Compliance Officer', 'Manager', 'Director']; // tmFourEyes
export const CO_ROLES = ['Compliance Officer']; // tmApproveFiuReport

export const roleOf = (u) => u?.app_role || u?.data?.app_role;

export async function loadCase(E, tenantId, id) {
  if (!id) throw httpError(400, 'tm_case_id is required');
  const found = asList(await E.TmCase.filter({ tenant_id: tenantId, id }))[0];
  if (!found || found.tenant_id !== tenantId) throw httpError(404, 'Case not found');
  return found;
}

export async function tenantUsers(E, tenantId) {
  const all = asList(await E.User.filter({ tenant_id: tenantId }, undefined, 1000));
  return all.filter((u) => (u.tenant_id || u.data?.tenant_id) === tenantId);
}

export const tlEntry = (auth, kind, text, extra = {}) => ({ at: new Date().toISOString(), kind, text, by: auth.actorName, ...extra });

/** Update the case, append one timeline entry and write one AuditEvent. Returns the merged case. */
export async function commit(ctx, tmCase, patch, entry, audit) {
  const timeline = [...(tmCase.timeline || []), entry];
  await ctx.E.TmCase.update(tmCase.id, { ...patch, timeline });
  await writeAudit(ctx.base44, ctx.auth, {
    tenantId: ctx.tenantId, clientId: tmCase.primary_client_id, eventType: audit.type,
    before: audit.before || {}, after: audit.after || {}, notes: audit.notes || entry.text,
  });
  return { ...tmCase, ...patch, timeline };
}

/** Case clock (via tmClock) for the case as it will look after the patch. Empty when no FIU profile exists. */
export async function clockPatch(ctx, tmCase, firstAlert) {
  const fiu = await loadFiuProfile(ctx.E, ctx.tenant);
  if (!fiu) return {};
  let alert = firstAlert;
  if (!alert && tmCase.alert_ids?.[0]) {
    alert = asList(await ctx.E.TmAlert.filter({ tenant_id: ctx.tenantId, id: tmCase.alert_ids[0] }))[0];
  }
  const c = caseClock(fiu, tmCase, alert?.indicator_type || 'subjective');
  return { phase: c.phase, ...(c.due_at ? { due_at: c.due_at } : {}) };
}

export const distinct = (arr) => [...new Set(arr.filter(Boolean))];

/** Every client on a case: primary, alert clients and network clients. */
export const caseClients = (primary, alertClients, network = []) => distinct([primary, ...alertClients, ...network]);

export async function nextCaseRef(E, tenantId) {
  const prefix = `CASE-${new Date().getUTCFullYear()}-`;
  const last = asList(await E.TmCase.filter({ tenant_id: tenantId, case_ref: { $regex: `^${prefix}` } }, '-case_ref', 1))[0];
  const n = last?.case_ref ? parseInt(last.case_ref.slice(prefix.length), 10) + 1 : 1;
  return `${prefix}${String(Number.isFinite(n) ? n : 1).padStart(4, '0')}`;
}

export async function fiuUnderway(E, tenantId, tmCaseId) {
  const rows = asList(await E.FiuReport.filter({ tenant_id: tenantId, tm_case_id: tmCaseId }, undefined, 20));
  return rows.some((r) => r.status !== 'rejected');
}

/** Customer-facing requests are blocked by the tipping-off lock and once an FIU report is being prepared. */
export async function assertCustomerRequestAllowed(ctx, tmCase) {
  const client = asList(await ctx.E.Client.filter({ tenant_id: ctx.tenantId, id: tmCase.primary_client_id }))[0];
  if (!client) throw httpError(404, 'Client not found');
  await assertClientNotLocked(ctx.base44, ctx.tenantId, client.id);
  if (await fiuUnderway(ctx.E, ctx.tenantId, tmCase.id)) throw httpError(423, 'Customer requests are locked once an FIU report is being prepared.');
  return client;
}

export async function createOutreach(ctx, { clientId, message, deadline, items, validDays = 8 }) {
  const rnd = () => crypto.randomUUID().replace(/-/g, '');
  const exp = new Date(deadline);
  exp.setUTCDate(exp.getUTCDate() + Math.max(1, validDays));
  return ctx.E.OutreachRequest.create({
    tenant_id: ctx.tenantId, client_id: clientId, standalone: true, message, deadline,
    delivery_channel: 'Portal', status: 'Draft', access_token: `${rnd()}${rnd().slice(0, 8)}`,
    token_expires_at: exp.toISOString(), items,
  });
}