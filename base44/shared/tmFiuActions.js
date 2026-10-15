// Lifecycle actions on an FIU report before generation: edit, submit, approve, reject, attachments.
import { asList, httpError } from './tmAuth.js';
import { writeAudit } from './tmAudit.js';
import { tenantUsers, roleOf, CO_ROLES } from './tmCaseCommon.js';
import { missingFields } from './tmFiuMap.js';
import { lockClient } from './tippingOff.js';
import { loadRefs, runChecks, buildApprovalSnapshot } from './tmFiuChecks.js';

const clip = (v) => String(v ?? '').slice(0, 300);

export async function loadReport(E, tenantId, id) {
  if (!id) throw httpError(400, 'report_id is required');
  const r = asList(await E.FiuReport.filter({ tenant_id: tenantId, id }))[0];
  if (!r || r.tenant_id !== tenantId) throw httpError(404, 'Report not found');
  return r;
}

const audit = (ctx, report, eventType, before, after, notes) =>
  writeAudit(ctx.base44, ctx.auth, { tenantId: ctx.tenantId, clientId: report.client_id, eventType, before, after, notes });

function upsertField(fields, path, label, value) {
  const rest = fields.filter((f) => f.path !== path);
  if (!value) return rest;
  const old = fields.find((f) => f.path === path);
  const next = { path, label: old?.label || label || path, value, source: 'User', by: 'user' };
  return old ? fields.map((f) => (f.path === path ? next : f)) : [...rest, next];
}

export async function updateField(ctx, report, { path, value }) {
  if (report.status !== 'draft') throw httpError(409, 'Only a draft report can be edited');
  if (!path) throw httpError(400, 'path is required');
  const { fiu, client } = await loadRefs(ctx, report);
  const text = String(value ?? '').trim();
  let fields = [...(report.fields || [])];
  let narrative = report.narrative || {};
  let before;
  if (path === 'narrative') {
    before = narrative.text;
    narrative = { ...narrative, text: String(value ?? '') };
    fields = upsertField(fields, 'report.reason', 'Reason for reporting', text);
  } else {
    before = fields.find((f) => f.path === path)?.value;
    fields = upsertField(fields, path, path, text);
  }
  const missing = missingFields(fiu?.mandatory_fields, fields, client);
  await ctx.E.FiuReport.update(report.id, { fields, narrative, missing_fields: missing });
  await audit(ctx, report, 'fiu_report_field_updated', { path, value: clip(before) }, { path, value: clip(text), missing_fields: missing },
    `FIU report ${report.report_ref}: ${path} updated by ${ctx.auth.actorName}.`);
  return { report_id: report.id, missing_fields: missing };
}

export async function toggleAttachment(ctx, report, { ref_id, selected }) {
  if (report.status !== 'draft') throw httpError(409, 'Attachments can be changed only on a draft report');
  const list = report.snapshot?.attachments || [];
  if (!list.some((a) => a.ref_id === ref_id)) throw httpError(404, 'Attachment not found');
  const attachments = list.map((a) => (a.ref_id === ref_id ? { ...a, selected: !!selected } : a));
  await ctx.E.FiuReport.update(report.id, { snapshot: { ...report.snapshot, attachments } });
  await audit(ctx, report, 'fiu_report_attachment_toggled', { ref_id, selected: !selected }, { ref_id, selected: !!selected }, `FIU report ${report.report_ref}: attachment ${ref_id} ${selected ? 'selected' : 'deselected'}.`);
  return { report_id: report.id };
}

async function notify(ctx, report, userIds, title, body, kind) {
  if (!userIds.length) return;
  await ctx.E.Notification.bulkCreate(userIds.map((uid) => ({
    tenant_id: ctx.tenantId, user_id: uid, type: 'fiu_report_review', title, body,
    link_tm_case_id: report.tm_case_id, link_client_id: report.client_id, link_fiu_report_id: report.id,
    dedupe_key: `${uid}:${report.id}:${kind}:${report.version || 1}`,
  })));
}

export async function submitForApproval(ctx, report) {
  if (report.status !== 'draft') throw httpError(409, 'Only a draft report can be sent for approval');
  const { fiu, client } = await loadRefs(ctx, report);
  const missing = missingFields(fiu?.mandatory_fields, report.fields || [], client);
  if (missing.length) throw httpError(422, `Mandatory fields are missing: ${missing.join(', ')}`);
  if (!String(report.narrative?.text || '').trim()) throw httpError(422, 'The reason for reporting is empty');
  const now = new Date().toISOString();
  await ctx.E.FiuReport.update(report.id, { status: 'in_review', missing_fields: [], submitted_for_approval_by: ctx.auth.actorUserId, submitted_for_approval_at: now });
  await lockClient(ctx.base44, { tenantId: ctx.tenantId, clientId: client.id, reason: report.report_ref, fiuReportId: report.id, actor: ctx.auth });
  const cos = (await tenantUsers(ctx.E, ctx.tenantId)).filter((u) => CO_ROLES.includes(roleOf(u)) && u.id !== ctx.auth.actorUserId);
  await notify(ctx, report, cos.map((u) => u.id), `FIU report ${report.report_ref} needs approval`, `${ctx.auth.actorName} sent the report for approval.`, 'review');
  await audit(ctx, report, 'fiu_report_submitted_for_approval', { status: 'draft' }, { status: 'in_review', notified: cos.length }, `FIU report ${report.report_ref} sent for approval by ${ctx.auth.actorName}.`);
  return { report_id: report.id, status: 'in_review', notified: cos.length };
}

export async function approve(ctx, report, { lateness_reason, rationale }) {
  if (report.status !== 'in_review') throw httpError(409, 'Only a report in review can be approved');
  if (ctx.auth.actorUserId && ctx.auth.actorUserId === report.prepared_by_user_id) throw httpError(403, 'The approver must differ from the person who prepared the report');
  const res = await runChecks(ctx, report, { latenessReason: lateness_reason });
  const failed = res.checks.filter((c) => !c.ok);
  if (failed.length) throw httpError(422, `Cannot approve: ${failed.map((c) => c.label).join('; ')}`);
  const snap = await buildApprovalSnapshot(ctx, report, res.data);
  const now = new Date().toISOString();
  const text = String(rationale || '').trim() || `Approved FIU report ${report.report_ref} after all checks passed.`;
  const decision = await ctx.E.Decision.create({
    tenant_id: ctx.tenantId, subject_type: 'fiu_report', subject_id: report.id, client_id: report.client_id, decision_type: 'report_decision',
    outcome: 'approved', rationale: text, decided_by_user_id: ctx.auth.actorUserId, decided_at: now, snapshot: snap,
  });
  const late = res.past_due ? String(lateness_reason || report.lateness_reason).trim() : report.lateness_reason;
  await ctx.E.FiuReport.update(report.id, {
    status: 'approved', approved_by_user_id: ctx.auth.actorUserId, approved_at: now, decision_id: decision.id,
    snapshot: { ...report.snapshot, ...snap }, approval: { checks: res.checks.map(({ key, ok }) => ({ key, ok })), at: now }, ...(late ? { lateness_reason: late } : {}),
  });
  await audit(ctx, report, 'fiu_report_approved', { status: 'in_review' }, { status: 'approved', decision_id: decision.id, late: res.past_due, profile_version: snap.profile_version },
    `FIU report ${report.report_ref} approved by ${ctx.auth.actorName}.`);
  return { report_id: report.id, status: 'approved', decision_id: decision.id };
}

export async function reject(ctx, report, { reason }) {
  if (report.status !== 'in_review') throw httpError(409, 'Only a report in review can be sent back');
  const why = String(reason || '').trim();
  if (why.length < 5) throw httpError(400, 'A reason is required');
  const version = (report.version || 1) + 1;
  await ctx.E.FiuReport.update(report.id, { status: 'draft', version, rejection_reason: why, approval: {} });
  if (report.prepared_by_user_id) await notify(ctx, report, [report.prepared_by_user_id], `FIU report ${report.report_ref} sent back`, why, 'rejected');
  await audit(ctx, report, 'fiu_report_rejected', { status: 'in_review', version: report.version }, { status: 'draft', version, reason: why },
    `FIU report ${report.report_ref} sent back to draft by ${ctx.auth.actorName}: ${why}`);
  return { report_id: report.id, status: 'draft', version };
}