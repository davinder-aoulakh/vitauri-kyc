// manageTmCase actions that reach the client or other records: EDR, customer requests, identity re-verification, network case.
import { asList, httpError } from './tmAuth.js';
import { fetchAll } from './tmCoverage.js';
import { OPEN_CASE, WORKABLE_CASE, tlEntry, commit, assertCustomerRequestAllowed, createOutreach, nextCaseRef, distinct } from './tmCaseCommon.js';

const isoDate = (d) => d.toISOString().slice(0, 10);
const plusDays = (n) => new Date(Date.now() + n * 86400000);

// Snapshot of the TM situation stored on the EDR KycCase (tm_alert_ids + tm_context).
async function tmContextSnapshot(ctx, tmCase) {
  const { E, tenantId } = ctx;
  const ids = (tmCase.alert_ids || []).slice(0, 100);
  const [client, alerts, profile, deviation] = await Promise.all([
    E.Client.filter({ tenant_id: tenantId, id: tmCase.primary_client_id }, undefined, 1).then((r) => asList(r)[0]),
    ids.length ? E.TmAlert.filter({ tenant_id: tenantId, id: { $in: ids } }, undefined, 100).then(asList) : [],
    E.ExpectedProfile.filter({ tenant_id: tenantId, client_id: tmCase.primary_client_id, status: 'approved' }, '-version', 1).then((r) => asList(r)[0]),
    E.TmAlert.filter({ tenant_id: tenantId, client_id: tmCase.primary_client_id, source: 'profile_deviation' }, '-created_date', 1).then((r) => asList(r)[0]),
  ]);
  return {
    tm_alert_ids: ids,
    tm_context: {
      score: client?.customer_risk_score ?? null,
      band: client?.customer_risk_band ?? null,
      alerts: alerts.map((a) => ({ id: a.id, title: a.title, score: a.score ?? null })),
      profile_version: profile?.version ?? null,
      breach_summary: deviation ? [deviation.title, ...(deviation.ai_reasons || []).slice(0, 2)].filter(Boolean).join(' · ') : null,
      tm_case_ref: tmCase.case_ref,
      opened_at: new Date().toISOString(),
    },
  };
}

export async function openEdr(ctx, tmCase) {
  const { E, auth, tenantId, tenant, base44 } = ctx;
  if (!OPEN_CASE.includes(tmCase.status)) throw httpError(409, `Case is ${tmCase.status}`);
  if (tmCase.kyc_edr_case_id) throw httpError(409, 'An event-driven review is already open for this case');
  const prev = asList(await E.KycCase.filter({ tenant_id: tenantId, client_id: tmCase.primary_client_id, status: 'Approved' }, '-created_date', 1))[0];
  const dueDate = isoDate(plusDays(tenant.edr_due_days || 30));
  const reason = `Transaction monitoring case ${tmCase.case_ref}: ${tmCase.title || 'investigation'}`;
  const analyst = prev?.assigned_analyst_id || tmCase.assigned_to_user_id || auth.actorUserId;
  const snap = await tmContextSnapshot(ctx, tmCase).catch(() => ({}));
  const kyc = await E.KycCase.create({
    ...snap,
    tenant_id: tenantId, client_id: tmCase.primary_client_id, case_type: 'Event_Driven_Review', status: 'Draft', assigned_analyst_id: analyst,
    trigger_reason: reason, due_date: dueDate, created_by_user_id: auth.actorUserId, previous_case_id: prev?.id || null, is_re_onboarding: false,
    risk_classification: prev?.risk_classification || null, tm_case_id: tmCase.id,
    step_1_status: 'not_started', step_2_status: 'not_started', step_3_status: 'not_started', step_4_status: 'not_started',
    step_5_status: 'not_started', step_6_status: 'not_started', step_7_status: 'not_started', step_8_status: 'not_started',
  });
  await E.AuditEvent.create({
    tenant_id: tenantId, case_id: kyc.id, client_id: tmCase.primary_client_id, actor_user_id: auth.actorUserId, actor_name: auth.actorName,
    actor_type: auth.actorType, event_type: 'edr_case_created_from_tm_case', before_state: {}, after_state: { kyc_case_id: kyc.id, tm_case_id: tmCase.id }, notes: reason,
  });
  if (analyst && analyst !== auth.actorUserId) {
    await E.Notification.create({
      tenant_id: tenantId, user_id: analyst, type: 'case_assigned', title: 'New EDR Case Assigned', link_case_id: kyc.id, link_client_id: tmCase.primary_client_id,
      body: `An Event-Driven Review was opened from transaction monitoring case ${tmCase.case_ref}. Due: ${dueDate}`,
    });
  }
  await commit({ base44, E, auth, tenantId }, tmCase, { kyc_edr_case_id: kyc.id },
    tlEntry(auth, 'edr_opened', `Event-driven review opened by ${auth.actorName}.`, { ref_id: kyc.id }),
    { type: 'tm_case_edr_opened', before: { kyc_edr_case_id: null }, after: { kyc_edr_case_id: kyc.id } });
  return { tm_case_id: tmCase.id, kyc_case_id: kyc.id };
}

export async function requestInfo(ctx, tmCase, body) {
  const { auth } = ctx;
  if (!WORKABLE_CASE.includes(tmCase.status)) throw httpError(409, `Case is ${tmCase.status}`);
  const client = await assertCustomerRequestAllowed(ctx, tmCase);
  const labels = distinct((Array.isArray(body.items) && body.items.length ? body.items : ['Source of funds documentation']).map((s) => String(s).trim())).slice(0, 10);
  const items = labels.map((label, i) => ({
    item_id: crypto.randomUUID(), sort_order: i, item_type: 'document', field_type: 'file_upload', label, status: 'Requested',
    validation_required: true, validation_max_file_size_mb: 25,
  }));
  const deadline = /^\d{4}-\d{2}-\d{2}$/.test(body.deadline || '') ? body.deadline : isoDate(plusDays(7));
  const req = await createOutreach(ctx, { clientId: client.id, message: String(body.message || '').trim(), deadline, items });
  await commit(ctx, tmCase, {}, tlEntry(auth, 'info_requested', `Information requested from ${client.full_name} by ${auth.actorName}: ${labels.join(', ')}.`, { ref_id: req.id }),
    { type: 'tm_case_info_requested', after: { outreach_id: req.id, items: labels } });
  return { tm_case_id: tmCase.id, outreach_id: req.id, access_token: req.access_token, client_email: client.primary_contact_email || null };
}

export async function reverifyIdentity(ctx, tmCase) {
  const { auth } = ctx;
  if (!WORKABLE_CASE.includes(tmCase.status)) throw httpError(409, `Case is ${tmCase.status}`);
  const client = await assertCustomerRequestAllowed(ctx, tmCase);
  const item = {
    item_id: crypto.randomUUID(), sort_order: 0, item_type: 'data_point', field_type: 'id_verification', label: 'Identity re-verification', status: 'Requested',
    idv_accepted_doc_types: ['Passport', 'Driving_Licence', 'National_ID'], idv_min_match_score: 75, idv_liveness_required: true, idv_auto_proceed: false, idv_workflow_id: '',
  };
  const req = await createOutreach(ctx, { clientId: client.id, message: 'Identity re-verification', deadline: isoDate(plusDays(7)), items: [item] });
  await commit(ctx, tmCase, {}, tlEntry(auth, 'idv_requested', `Identity re-verification started for ${client.full_name} by ${auth.actorName}.`, { ref_id: req.id }),
    { type: 'tm_case_idv_requested', after: { outreach_id: req.id, item_id: item.item_id } });
  return { tm_case_id: tmCase.id, outreach_id: req.id, item_id: item.item_id, access_token: req.access_token };
}

export async function openNetworkCase(ctx, tmCase) {
  const { E, auth, tenantId } = ctx;
  if (!OPEN_CASE.includes(tmCase.status)) throw httpError(409, `Case is ${tmCase.status}`);
  const base = distinct([tmCase.primary_client_id, ...(tmCase.client_ids || [])]);
  const own = await fetchAll((cursor) => E.Transaction.filter({ tenant_id: tenantId, client_id: { $in: base } }, { limit: 1000, cursor, fields: ['counterparty_id', 'own_transfer'] }), 3);
  const cpIds = distinct(own.filter((t) => !t.own_transfer).map((t) => t.counterparty_id)).slice(0, 200);
  if (!cpIds.length) throw httpError(409, 'No counterparties are on file for this case yet');
  const shared = await fetchAll((cursor) => E.Transaction.filter({ tenant_id: tenantId, counterparty_id: { $in: cpIds }, client_id: { $nin: base } }, { limit: 500, cursor, fields: ['client_id'] }), 2);
  const candidates = distinct(shared.map((t) => t.client_id));
  const clients = candidates.length ? asList(await E.Client.filter({ tenant_id: tenantId, id: { $in: candidates.slice(0, 50) } }, undefined, 50)).filter((c) => !c.is_deleted) : [];
  if (!clients.length) throw httpError(409, 'No other clients share counterparties with this case');
  const others = clients.map((c) => c.id);
  const net = await E.TmCase.create({
    tenant_id: tenantId, case_ref: await nextCaseRef(E, tenantId), primary_client_id: tmCase.primary_client_id, client_ids: [...base, ...others],
    network_client_ids: others, network_origin_case_id: tmCase.id, alert_ids: [], evidence: [], status: 'open', title: `Network: ${tmCase.title || tmCase.case_ref}`,
    assigned_to_user_id: tmCase.assigned_to_user_id, four_eyes_user_id: tmCase.four_eyes_user_id,
    timeline: [tlEntry(auth, 'created', `Network case opened from ${tmCase.case_ref} by ${auth.actorName}. Adds ${others.length} client(s) sharing counterparties: ${clients.map((c) => c.full_name).join(', ')}.`)],
  });
  await E.AuditEvent.create({
    tenant_id: tenantId, client_id: tmCase.primary_client_id, actor_user_id: auth.actorUserId, actor_name: auth.actorName, actor_type: auth.actorType,
    event_type: 'tm_network_case_created', before_state: {}, after_state: { tm_case_id: net.id, origin: tmCase.id, client_ids: others }, notes: `Network case ${net.case_ref} opened from ${tmCase.case_ref}.`,
  });
  await commit(ctx, tmCase, {}, tlEntry(auth, 'network_case', `Network case ${net.case_ref} opened with ${others.length} additional client(s).`, { ref_id: net.id }),
    { type: 'tm_case_network_opened', after: { network_case_id: net.id, client_ids: others } });
  return { tm_case_id: tmCase.id, network_case_id: net.id, case_ref: net.case_ref, added_clients: others.length };
}