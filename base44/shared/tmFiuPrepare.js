// Prepares (or refreshes) an FIU report: evidence, field mapping, narrative, clock, status, tipping-off lock, audit.
// Two entries: from a TM case / alert / KYC case (prepareReport), or for a client + selected transactions without a case
// (prepareReport with clientId + reportType: manual reports and the automatic CTR/TTR/IFT/CBR/TFR proposals).
import { asList, httpError, WORK_ROLES } from './tmAuth.js';
import { writeAudit } from './tmAudit.js';
import { loadCase, tenantUsers, roleOf, CO_ROLES } from './tmCaseCommon.js';
import { createCase } from './tmCaseCore.js';
import { computeDue } from './tmClock.js';
import { gatherReportData } from './tmFiuGather.js';
import { writeNarrative } from './tmFiuNarrative.js';
import { resolveProfileCode, buildFields, missingFields, buildAttachments, buildSnapshot, distinct, mappedTxnCount } from './tmFiuMap.js';
import { lockClient, isLockingStatus } from './tippingOff.js';
import { FIU_TYPES, normaliseType, enabledTypes, reportCodeFor } from './fiuTypes.js';

const earliest = (arr) => arr.filter(Boolean).sort()[0];
const HOUR = 3600000;

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

/** <TYPE>-<FIU>-NNNN per tenant, e.g. CTR-CW-0001. Legacy objective/subjective reports keep the UTR series. */
export async function nextReportRef(E, tenantId, code, type = 'UTR') {
  const prefix = `${normaliseType(type)}-${code}-`;
  const last = asList(await E.FiuReport.filter({ tenant_id: tenantId, report_ref: { $regex: `^${prefix}` } }, '-report_ref', 1))[0];
  const n = last?.report_ref ? parseInt(last.report_ref.slice(prefix.length), 10) + 1 : 1;
  return `${prefix}${String(Number.isFinite(n) ? n : 1).padStart(4, '0')}`;
}

const summary = (report, tmCase, extra = {}) => ({
  tm_case_id: tmCase?.id || null, report_id: report.id, report_ref: report.report_ref, status: report.status, type: report.type,
  missing_fields: report.missing_fields || [], locked: isLockingStatus(report.status), ...extra,
});

/** Deadline per report type. Threshold reports run on the objective clock; TFR is due without delay. */
function buildClock(fiu, { type, objective, d, tmCase }) {
  const now = new Date().toISOString();
  const clock = {
    intended_at: earliest(d.txns.map((t) => t.intended_at)) || earliest(d.alerts.map((a) => a.intended_at)),
    executed_at: earliest(d.txns.map((t) => t.executed_at)) || earliest(d.alerts.map((a) => a.executed_at)),
    received_at: earliest(d.alerts.map((a) => a.received_at || a.created_date)),
    discovered_at: earliest(d.alerts.map((a) => a.discovered_at || a.received_at || a.created_date)) || tmCase?.created_date || now,
    escalated_at: tmCase?.escalated_to_co_at, decided_at: tmCase?.co_decided_at,
  };
  if (type === 'TFR') {
    clock.due_at = new Date(new Date(clock.discovered_at).getTime() + (Number(fiu.tf_report_deadline_hours) || 24) * HOUR).toISOString();
  } else if (FIU_TYPES[type]?.threshold) {
    clock.due_at = computeDue({ ...fiu, report_without_delay: false }, { indicator_type: 'objective', ...clock }).due_at;
  } else if (!tmCase && !objective) {
    // Manual SAR/STR/UTR without a case: preparing it is the decision to report.
    clock.decided_at = clock.decided_at || now;
    clock.due_at = computeDue(fiu, { indicator_type: 'subjective', ...clock }).due_at;
  } else {
    clock.due_at = computeDue(fiu, { indicator_type: objective ? 'objective' : 'subjective', ...clock }).due_at;
  }
  for (const k of Object.keys(clock)) if (!clock[k]) delete clock[k];
  return clock;
}

/**
 * refresh: regenerate an existing DRAFT (user action). Non-draft reports are never changed.
 * reportType: SAR/STR/CTR/TTR/UTR/IFT/CBR/TFR. Without it a case report is the legacy objective/subjective UTR.
 * clientId + transactionIds (+ alertIds): a report without a TM case. origin / proposal / narrativeText / priority / freezeAdvised
 * are set by the automatic proposals.
 */
export async function prepareReport(ctx, opts) {
  const { tmCaseId, alertId, kycCaseId, profileCode, refresh, reportType: wantedType, transactionIds = [], alertIds = [], clientId,
    origin, proposal, narrativeText, priority, freezeAdvised, existingReportId } = opts;
  const { E, base44, tenantId, tenant, auth } = ctx;
  if (wantedType && !FIU_TYPES[wantedType]) throw httpError(400, `Unknown report type ${wantedType}`);
  const users = await tenantUsers(E, tenantId);
  const caseLess = !tmCaseId && !alertId && !kycCaseId;
  if (caseLess && (!clientId || !wantedType)) throw httpError(400, 'client_id and report_type are required for a report without a TM case');
  const tmCase = caseLess ? null : kycCaseId ? await resolveKycCase(ctx, kycCaseId) : await resolveCase(ctx, { tmCaseId, alertId }, users);

  // Existing open report of the same type for this case (one per case per type); case-less reports are refreshed by id only.
  let existing = null;
  if (tmCase) {
    const open = asList(await E.FiuReport.filter({ tenant_id: tenantId, tm_case_id: tmCase.id }, 'created_date', 20)).filter((r) => r.status !== 'rejected');
    existing = wantedType ? open.find((r) => normaliseType(r.type) === wantedType) : open[0];
  } else if (existingReportId) {
    existing = asList(await E.FiuReport.filter({ tenant_id: tenantId, id: existingReportId }, undefined, 1))[0] || null;
  }
  if (existing && (!refresh || existing.status !== 'draft')) {
    if (kycCaseId && !existing.kyc_case_id) await E.FiuReport.update(existing.id, { kyc_case_id: kycCaseId }).catch(() => {});
    return summary(existing, tmCase, { existing: true });
  }

  const d = await gatherReportData(ctx, tmCase, {
    clientId, alertIds: [...alertIds, ...(existing?.alert_ids || [])], txnIds: [...transactionIds, ...(existing?.transaction_ids || [])],
  });
  const code = profileCode || existing?.fiu_profile_code || resolveProfileCode(d.client);
  const fiu = asList(await E.FiuProfile.filter({ tenant_id: tenantId, code }))[0];
  if (!fiu) throw httpError(404, `No ${code} FIU profile is configured. Load the FIU profiles in Tenant Config first.`);
  const typeWanted = wantedType || (existing && FIU_TYPES[existing.type] ? existing.type : null);
  if (typeWanted && !enabledTypes(fiu).includes(typeWanted)) throw httpError(409, `${typeWanted} reports are not enabled in the ${code} FIU profile`);
  if (typeWanted && FIU_TYPES[typeWanted].kind === 'transaction' && !d.txns.length) throw httpError(422, `A ${typeWanted} needs at least one transaction of this client`);

  const cur = tenant.tm_reporting_currency || 'USD';
  const typeOf = (a) => d.scenarios.find((s) => s.id === a.scenario_id)?.indicator_type || a.indicator_type;
  const objective = d.alerts.length > 0 && d.alerts.every((a) => typeOf(a) === 'objective');
  const storedType = typeWanted || (objective ? 'unusual_objective' : 'unusual_subjective');
  const type = normaliseType(storedType);
  const indicatorCodes = distinct(d.scenarios.flatMap((s) => s.fiu_indicator_codes?.[code] || []));
  const templateCode = String(fiu.didit_template_ids?.[storedType] || fiu.didit_template_ids?.[type] || fiu.didit_template_ids?.[objective ? 'objective' : 'subjective'] || '').trim() || type;
  const clock = buildClock(fiu, { type, objective, d, tmCase });

  const officer = users.find((u) => u.id === auth.actorUserId && CO_ROLES.includes(roleOf(u))) || users.find((u) => CO_ROLES.includes(roleOf(u)));
  const narrative = narrativeText
    ? { text: narrativeText, citations: [], gaps: [] }
    : await writeNarrative(ctx, { tmCase, alerts: d.alerts, txns: d.txns, approved: d.approved, client: d.client, cur, reportType: type });
  const fields = buildFields({ tenant, officer, reportType: type, reportCode: reportCodeFor(fiu, type), fiu, indicatorCodes, client: d.client, accounts: d.accounts, txns: d.txns, counterparties: d.counterparties, parties: d.parties, cur, reason: narrative.text, idv: d.idv });
  const missing = missingFields(fiu.mandatory_fields, fields, d.client);
  const status = missing.length || !narrative.text ? 'draft' : 'in_review';
  const snapshot = buildSnapshot({
    txns: d.txns, counterparties: d.counterparties, accounts: d.accounts, parties: d.parties,
    attachments: buildAttachments(d),
    extra: { profile_version: d.approved?.version ?? null, narrative_run_id: narrative.ai_run_id || null, narrative_error: narrative.error || null, data_gaps: narrative.gaps },
  });
  const urgent = type === 'TFR' || priority === 'without_delay';
  const body = {
    fiu_profile_code: code, tm_case_id: tmCase?.id, client_id: d.client.id, alert_ids: d.alerts.map((a) => a.id), type: storedType,
    goaml_report_code: reportCodeFor(fiu, type),
    transaction_ids: (() => { const want = new Set([...transactionIds, ...(existing?.transaction_ids || [])]); return d.txns.map((t) => t.id).filter((id) => want.has(id)); })(),
    origin: origin || existing?.origin || (caseLess ? 'manual' : kycCaseId ? 'kyc_case' : tmCaseId ? 'tm_case' : 'alert'),
    priority: urgent ? 'without_delay' : 'normal', freeze_advised: type === 'TFR' ? (freezeAdvised ?? true) : false,
    ...(proposal || existing?.proposal ? { proposal: proposal || existing.proposal } : {}),
    indicators: indicatorCodes, status, fields, missing_fields: missing, transactions_mapped: mappedTxnCount(d.txns),
    didit_template_code: templateCode, narrative: { text: narrative.text, citations: narrative.citations }, clock,
    prepared_by_user_id: auth.actorUserId, snapshot,
    ...(kycCaseId ? { kyc_case_id: kycCaseId } : {}),
  };
  if (!body.tm_case_id) delete body.tm_case_id;
  // Automatic proposals stay drafts so a person always reviews them before the four-eyes approval.
  if (origin === 'auto_threshold' || origin === 'auto_tf') body.status = 'draft';

  let report;
  if (existing) {
    report = { ...existing, ...body, version: (existing.version || 1) + 1 };
    await E.FiuReport.update(existing.id, { ...body, version: report.version });
  } else {
    report = await E.FiuReport.create({ ...body, tenant_id: tenantId, report_ref: await nextReportRef(E, tenantId, code, storedType), version: 1 });
    if (tmCase) { // concurrent duplicate of the same type on the same case
      const dupes = asList(await E.FiuReport.filter({ tenant_id: tenantId, tm_case_id: tmCase.id }, 'created_date', 20))
        .filter((r) => r.status !== 'rejected' && normaliseType(r.type) === type);
      if (dupes[0] && dupes[0].id !== report.id) {
        await E.FiuReport.delete(report.id);
        if (kycCaseId && !dupes[0].kyc_case_id) await E.FiuReport.update(dupes[0].id, { kyc_case_id: kycCaseId }).catch(() => {});
        return summary(dupes[0], tmCase, { existing: true });
      }
    }
  }

  // A TFR locks customer communications from the first draft (no tipping-off while it is prepared without delay).
  const locked = isLockingStatus(body.status) || type === 'TFR' ? await lockClient(base44, { tenantId, clientId: d.client.id, reason: report.report_ref, fiuReportId: report.id, actor: auth }) : false;
  await writeAudit(base44, auth, {
    tenantId, clientId: d.client.id, eventType: existing ? 'fiu_report_refreshed' : 'fiu_report_prepared',
    before: existing ? { status: existing.status, missing_fields: existing.missing_fields, version: existing.version } : {},
    after: { report_ref: report.report_ref, status: body.status, missing_fields: missing, type: storedType, origin: body.origin, priority: body.priority, transactions: d.txns.length, indicators: indicatorCodes, tm_case_id: tmCase?.id || null, narrative_cited: !!narrative.text },
    notes: `FIU report ${report.report_ref} (${type}) ${existing ? 'refreshed' : 'prepared'} (${body.status}${missing.length ? `, ${missing.length} mandatory field(s) missing` : ''}).${narrative.error ? ` Narrative: ${narrative.error}` : ''}`,
  });
  if (tmCase) {
    const entry = { at: new Date().toISOString(), kind: 'fiu_report', by: auth.actorName, text: `FIU report ${report.report_ref} (${type}) ${existing ? 'refreshed' : 'prepared'} as ${body.status}.${missing.length ? ` Missing: ${missing.join(', ')}.` : ''}` };
    await E.TmCase.update(tmCase.id, { timeline: [...(tmCase.timeline || []), entry] });
  }
  return summary({ ...report, status: body.status }, tmCase, { locked: locked || (!!d.client.tipping_off_lock && (isLockingStatus(body.status) || type === 'TFR')) });
}
