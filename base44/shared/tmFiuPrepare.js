// Prepares (or refreshes) an FIU report for a TM case: evidence, field mapping, narrative, clock, status, tipping-off lock, audit.
import { asList, httpError, WORK_ROLES } from './tmAuth.js';
import { writeAudit } from './tmAudit.js';
import { loadCase, tenantUsers, roleOf, CO_ROLES } from './tmCaseCommon.js';
import { createCase } from './tmCaseCore.js';
import { computeDue } from './tmClock.js';
import { gatherReportData } from './tmFiuGather.js';
import { writeNarrative } from './tmFiuNarrative.js';
import { resolveProfileCode, buildFields, missingFields, buildAttachments, buildSnapshot, distinct, mappedTxnCount } from './tmFiuMap.js';
import { lockClient, isLockingStatus } from './tippingOff.js';

const earliest = (arr) => arr.filter(Boolean).sort()[0];

async function resolveCase(ctx, { tmCaseId, alertId }, users) {
  const { E, tenantId, auth } = ctx;
  if (tmCaseId) return loadCase(E, tenantId, tmCaseId);
  if (!alertId) throw httpError(400, 'tm_case_id or alert_id is required');
  const alert = asList(await E.TmAlert.filter({ tenant_id: tenantId, id: alertId }))[0];
  if (!alert) throw httpError(404, 'Alert not found');
  if (alert.tm_case_id) return loadCase(E, tenantId, alert.tm_case_id);
  const workers = users.filter((u) => WORK_ROLES.includes(roleOf(u)));
  const assignee = auth.actorUserId || workers.find((u) => u.id === alert.assigned_to_user_id)?.id || (workers.find((u) => CO_ROLES.includes(roleOf(u))) || workers[0])?.id;
  if (!assignee) throw httpError(409, 'No investigator is available to own the case');
  const created = await createCase(ctx, null, { alert_ids: [alertId], assigned_to_user_id: assignee });
  return loadCase(E, tenantId, created.tm_case_id);
}

// KYC case entry: use KycCase.tm_case_id, else a TmCase with kyc_edr_case_id, else create one from the client's open alerts.
async function resolveKycCase(ctx, kycCaseId) {
  const { E, tenantId, auth } = ctx;
  const kyc = asList(await E.KycCase.filter({ tenant_id: tenantId, id: kycCaseId }, undefined, 1))[0];
  if (!kyc) throw httpError(404, 'KYC case not found');
  let tmCase = null;
  if (kyc.tm_case_id) tmCase = asList(await E.TmCase.filter({ tenant_id: tenantId, id: kyc.tm_case_id }, undefined, 1))[0] || null;
  if (!tmCase) tmCase = asList(await E.TmCase.filter({ tenant_id: tenantId, kyc_edr_case_id: kycCaseId }, '-created_date', 1))[0] || null;
  if (!tmCase) {
    let ids = (kyc.tm_alert_ids || []).slice(0, 50);
    if (!ids.length) {
      const open = asList(await E.TmAlert.filter({ tenant_id: tenantId, client_id: kyc.client_id, status: { $in: ['new', 'triaged', 'in_review'] } }, '-created_date', 50));
      ids = open.filter((a) => !a.tm_case_id).map((a) => a.id);
    }
    if (!ids.length) throw httpError(409, 'No transaction monitoring alerts are available to open a case from this KYC case');
    const created = await createCase(ctx, null, { alert_ids: ids, title: `From KYC case ${String(kycCaseId).slice(-6)}` });
    await E.TmCase.update(created.tm_case_id, { kyc_edr_case_id: kycCaseId });
    tmCase = await loadCase(E, tenantId, created.tm_case_id);
  }
  if (kyc.tm_case_id !== tmCase.id) {
    await E.KycCase.update(kycCaseId, { tm_case_id: tmCase.id });
    await writeAudit(ctx.base44, auth, {
      tenantId, clientId: kyc.client_id, eventType: 'kyc_case_linked_to_tm_case',
      before: { tm_case_id: kyc.tm_case_id || null }, after: { kyc_case_id: kycCaseId, tm_case_id: tmCase.id }, notes: `KYC case linked to TM case ${tmCase.case_ref} for FIU report preparation.`,
    });
  }
  return tmCase;
}

async function nextReportRef(E, tenantId, code) {
  const prefix = `UTR-${code}-`;
  const last = asList(await E.FiuReport.filter({ tenant_id: tenantId, report_ref: { $regex: `^${prefix}` } }, '-report_ref', 1))[0];
  const n = last?.report_ref ? parseInt(last.report_ref.slice(prefix.length), 10) + 1 : 1;
  return `${prefix}${String(Number.isFinite(n) ? n : 1).padStart(4, '0')}`;
}

const summary = (report, tmCase, extra = {}) => ({
  tm_case_id: tmCase.id, report_id: report.id, report_ref: report.report_ref, status: report.status,
  missing_fields: report.missing_fields || [], locked: isLockingStatus(report.status), ...extra,
});

/** refresh: regenerate an existing DRAFT (user action). Non-draft reports are never changed. */
export async function prepareReport(ctx, { tmCaseId, alertId, kycCaseId, profileCode, refresh }) {
  const { E, base44, tenantId, tenant, auth } = ctx;
  const users = await tenantUsers(E, tenantId);
  const tmCase = kycCaseId ? await resolveKycCase(ctx, kycCaseId) : await resolveCase(ctx, { tmCaseId, alertId }, users);
  const open = async () => asList(await E.FiuReport.filter({ tenant_id: tenantId, tm_case_id: tmCase.id }, 'created_date', 20)).filter((r) => r.status !== 'rejected');
  const existing = (await open())[0];
  if (existing && (!refresh || existing.status !== 'draft')) {
    if (kycCaseId && !existing.kyc_case_id) await E.FiuReport.update(existing.id, { kyc_case_id: kycCaseId }).catch(() => {});
    return summary(existing, tmCase, { existing: true });
  }

  const d = await gatherReportData(ctx, tmCase);
  const code = profileCode || existing?.fiu_profile_code || resolveProfileCode(d.client);
  const fiu = asList(await E.FiuProfile.filter({ tenant_id: tenantId, code }))[0];
  if (!fiu) throw httpError(404, `No ${code} FIU profile is configured. Load the FIU profiles in Tenant Config first.`);

  const cur = tenant.tm_reporting_currency || 'USD';
  const typeOf = (a) => d.scenarios.find((s) => s.id === a.scenario_id)?.indicator_type || a.indicator_type;
  const objective = d.alerts.length > 0 && d.alerts.every((a) => typeOf(a) === 'objective');
  const reportType = objective ? 'unusual_objective' : 'unusual_subjective';
  const indicatorCodes = distinct(d.scenarios.flatMap((s) => s.fiu_indicator_codes?.[code] || []));
  // Didit template for this report type (same lookup as tmFiuGenerate); 'UTR' when the profile has none configured.
  const templateCode = String(fiu.didit_template_ids?.[reportType] || fiu.didit_template_ids?.[objective ? 'objective' : 'subjective'] || '').trim() || 'UTR';
  const clock = {
    intended_at: earliest(d.txns.map((t) => t.intended_at)) || earliest(d.alerts.map((a) => a.intended_at)),
    executed_at: earliest(d.txns.map((t) => t.executed_at)) || earliest(d.alerts.map((a) => a.executed_at)),
    received_at: earliest(d.alerts.map((a) => a.received_at || a.created_date)),
    discovered_at: earliest(d.alerts.map((a) => a.discovered_at || a.received_at || a.created_date)) || tmCase.created_date,
    escalated_at: tmCase.escalated_to_co_at, decided_at: tmCase.co_decided_at,
  };
  clock.due_at = computeDue(fiu, { indicator_type: objective ? 'objective' : 'subjective', ...clock }).due_at;
  for (const k of Object.keys(clock)) if (!clock[k]) delete clock[k];

  const officer = users.find((u) => u.id === auth.actorUserId && CO_ROLES.includes(roleOf(u))) || users.find((u) => CO_ROLES.includes(roleOf(u)));
  const narrative = await writeNarrative(ctx, { tmCase, alerts: d.alerts, txns: d.txns, approved: d.approved, client: d.client, cur });
  const fields = buildFields({ tenant, officer, reportType, indicatorCodes, client: d.client, accounts: d.accounts, txns: d.txns, counterparties: d.counterparties, parties: d.parties, cur, reason: narrative.text, idv: d.idv });
  const missing = missingFields(fiu.mandatory_fields, fields, d.client);
  const status = missing.length ? 'draft' : 'in_review';
  const snapshot = buildSnapshot({
    txns: d.txns, counterparties: d.counterparties, accounts: d.accounts, parties: d.parties,
    attachments: buildAttachments(d),
    extra: { profile_version: d.approved?.version ?? null, narrative_run_id: narrative.ai_run_id || null, narrative_error: narrative.error || null, data_gaps: narrative.gaps },
  });
  const body = {
    fiu_profile_code: code, tm_case_id: tmCase.id, client_id: d.client.id, alert_ids: d.alerts.map((a) => a.id), type: reportType,
    indicators: indicatorCodes, status, fields, missing_fields: missing, transactions_mapped: mappedTxnCount(d.txns), didit_template_code: templateCode, narrative: { text: narrative.text, citations: narrative.citations }, clock,
    prepared_by_user_id: auth.actorUserId, snapshot,
    ...(kycCaseId ? { kyc_case_id: kycCaseId } : {}),
  };

  let report;
  if (existing) {
    report = { ...existing, ...body, version: (existing.version || 1) + 1 };
    await E.FiuReport.update(existing.id, { ...body, version: report.version });
  } else {
    report = await E.FiuReport.create({ ...body, tenant_id: tenantId, report_ref: await nextReportRef(E, tenantId, code), version: 1 });
    const all = await open();
    if (all[0] && all[0].id !== report.id) { await E.FiuReport.delete(report.id); if (kycCaseId && !all[0].kyc_case_id) await E.FiuReport.update(all[0].id, { kyc_case_id: kycCaseId }).catch(() => {}); return summary(all[0], tmCase, { existing: true }); } // concurrent duplicate
  }

  const locked = isLockingStatus(status) ? await lockClient(base44, { tenantId, clientId: d.client.id, reason: report.report_ref, fiuReportId: report.id, actor: auth }) : false;
  await writeAudit(base44, auth, {
    tenantId, clientId: d.client.id, eventType: existing ? 'fiu_report_refreshed' : 'fiu_report_prepared',
    before: existing ? { status: existing.status, missing_fields: existing.missing_fields, version: existing.version } : {},
    after: { report_ref: report.report_ref, status, missing_fields: missing, type: reportType, indicators: indicatorCodes, tm_case_id: tmCase.id, narrative_cited: !!narrative.text },
    notes: `FIU report ${report.report_ref} ${existing ? 'refreshed' : 'prepared'} (${status}${missing.length ? `, ${missing.length} mandatory field(s) missing` : ''}).${narrative.error ? ` Narrative: ${narrative.error}` : ''}`,
  });
  const entry = { at: new Date().toISOString(), kind: 'fiu_report', by: auth.actorName, text: `FIU report ${report.report_ref} ${existing ? 'refreshed' : 'prepared'} as ${status}.${missing.length ? ` Missing: ${missing.join(', ')}.` : ''}` };
  await E.TmCase.update(tmCase.id, { timeline: [...(tmCase.timeline || []), entry] });
  return summary(report, tmCase, { locked: locked || !!d.client.tipping_off_lock && isLockingStatus(status) });
}