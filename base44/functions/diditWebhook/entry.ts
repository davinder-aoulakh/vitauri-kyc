/**
 * Didit Webhook receiver (V3).
 *
 * Verifies X-Signature-V2 (HMAC-SHA256, canonicalised) against the receiving
 * tenant's didit_webhook_secret, enforces X-Timestamp freshness (<=300s), dedupes
 * on event_id, then dispatches on the V3 top-level envelope fields.
 *
 * Tenant is resolved from metadata.tenant_id (session-level events) or, when
 * absent, via the Client entity looked up by vendor_data (user-level events).
 * There is no open mode — any event whose tenant can't be resolved, or whose
 * tenant has no webhook secret, or whose signature doesn't verify, is rejected.
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';
import { waitUntil } from 'base44:runtime';
import { fetchDiditDecision } from '../../shared/diditDecision.js';
import { verifyDiditSignature, isTimestampFresh } from '../../shared/diditWebhookVerify.js';

const NON_TERMINAL_STATUSES = ['Not Started', 'In Progress', 'Awaiting User'];
const TERMINAL_SESSION_STATUSES = ['Approved', 'Declined', 'In Review', 'Abandoned', 'Expired'];

export default async function(req) {
  try {
    const rawBody = await req.text();
    let parsed;
    try {
      parsed = JSON.parse(rawBody);
    } catch {
      return Response.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    const sigHeader = req.headers.get('x-signature-v2') || '';
    const tsHeader  = req.headers.get('x-timestamp');

    // 1. Freshness — reject anything older/newer than 300s (replay protection).
    if (!isTimestampFresh(tsHeader)) {
      return Response.json({ error: 'stale or missing timestamp' }, { status: 401 });
    }

    const base44 = createClientFromRequest(req);
    let tenantId = parsed?.metadata?.tenant_id;

    // 2. Resolve the tenant. Session-level events carry metadata.tenant_id directly.
    //    User-level events (user.status.updated / user.data.updated) have no session
    //    metadata — resolve via the Client entity using vendor_data (client_id).
    let tenant = null;
    if (tenantId) {
      const tenants = await base44.asServiceRole.entities.Tenant.filter({ id: tenantId });
      tenant = tenants?.[0] || null;
    } else if (parsed?.vendor_data) {
      const clients = await base44.asServiceRole.entities.Client.filter({ id: parsed.vendor_data });
      const client = clients?.[0];
      if (client?.tenant_id) {
        tenantId = client.tenant_id;
        const tenants = await base44.asServiceRole.entities.Tenant.filter({ id: tenantId });
        tenant = tenants?.[0] || null;
      }
    }

    // 3. No open mode — a tenant must be resolvable and have a webhook secret,
    //    and the signature must verify against it, or the event is rejected.
    if (!tenant?.didit_webhook_secret) {
      console.warn('diditWebhook: no resolvable tenant/secret — rejecting', { tenantId, sessionId: parsed.session_id });
      return Response.json({ error: 'unauthorized' }, { status: 401 });
    }

    const valid = await verifyDiditSignature(rawBody, sigHeader, tenant.didit_webhook_secret);
    if (!valid) {
      console.warn('diditWebhook: signature verification failed', { tenantId, sessionId: parsed.session_id });
      return Response.json({ error: 'invalid signature' }, { status: 401 });
    }

    // Ensure downstream handlers always see the resolved tenant_id, even when it
    // was derived from vendor_data rather than carried in the original metadata.
    parsed.metadata = { ...(parsed.metadata || {}), tenant_id: tenantId };

    // 4. Idempotency — dedupe on event_id.
    const eventId = parsed.event_id;
    if (eventId && tenantId) {
      const existing = await base44.asServiceRole.entities.DiditWebhookEvent.filter({ tenant_id: tenantId, event_id: eventId });
      if (existing?.length > 0) {
        return Response.json({ ok: true, duplicate: true });
      }
      waitUntil(base44.asServiceRole.entities.DiditWebhookEvent.create({
        tenant_id:    tenantId,
        event_id:     eventId,
        session_id:   parsed.session_id,
        webhook_type: parsed.webhook_type,
        status:       parsed.status,
        processed_at: new Date().toISOString(),
      }).catch(() => {}));
    }

    // 5. Respond immediately; process the event in the background.
    waitUntil(processWebhookEvent(base44, parsed));

    return Response.json({ ok: true, received: true });
  } catch (error) {
    console.error('diditWebhook error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
}

async function processWebhookEvent(base44, body) {
  try {
    const tenantId    = body.metadata?.tenant_id;
    const status       = body.status;
    const webhookType  = body.webhook_type;

    // Ongoing monitoring — user-level (not session-level) events.
    if (webhookType === 'user.status.updated' || webhookType === 'user.data.updated') {
      await handleOngoingMonitoring(base44, tenantId, body);
      return;
    }

    // Session-level data refresh — extracted fields changed without a status change.
    if (webhookType === 'data.updated' && !TERMINAL_SESSION_STATUSES.includes(status) && status !== 'Resubmitted' && status !== 'Kyc Expired') {
      await handleDataUpdated(base44, body);
      return;
    }

    if (status === 'Resubmitted') {
      await handleResubmitted(base44, tenantId, body);
      return;
    }

    if (status === 'Kyc Expired') {
      await handleKycExpired(base44, tenantId, body);
      return;
    }

    if (NON_TERMINAL_STATUSES.includes(status)) {
      await updateSessionStatusOnly(base44, body);
      return;
    }

    if (TERMINAL_SESSION_STATUSES.includes(status)) {
      await processTerminalDecisionImpl(base44, body);
      return;
    }

    console.log('diditWebhook: unhandled status', status);
  } catch (err) {
    console.error('diditWebhook processWebhookEvent error:', err);
  }
}

// ── Non-terminal: just reflect the live status on the item ───────────────────
async function updateSessionStatusOnly(base44, body) {
  const outreachId = body.metadata?.outreach_id;
  const itemId      = body.metadata?.item_id;
  const sessionId    = body.session_id;
  if (!outreachId) return;

  const outreachList = await base44.asServiceRole.entities.OutreachRequest.filter({ id: outreachId });
  const outreach = outreachList?.[0];
  if (!outreach) return;

  const updatedItems = (outreach.items || []).map(it => {
    const matches = itemId ? it.item_id === itemId : it.didit_session_id === sessionId;
    return matches ? { ...it, didit_session_status: body.status } : it;
  });
  await base44.asServiceRole.entities.OutreachRequest.update(outreachId, { items: updatedItems });
}

// ── data.updated: extracted fields refreshed without a status change ─────────
async function handleDataUpdated(base44, body) {
  const sessionId  = body.session_id;
  const outreachId = body.metadata?.outreach_id;
  const itemId      = body.metadata?.item_id;
  const tenantId    = body.metadata?.tenant_id;
  if (!outreachId || !tenantId) return;

  const tenants = await base44.asServiceRole.entities.Tenant.filter({ id: tenantId });
  const tenant  = tenants?.[0];
  if (!tenant?.didit_api_key) { console.warn('diditWebhook: no Didit API key for tenant', tenantId); return; }

  const result = await fetchDiditDecision(sessionId, tenant.didit_api_key);
  if (result.pending || !result.idvFields) { console.log('diditWebhook: data.updated but no usable decision yet', sessionId); return; }

  const { idvFields } = result;

  const outreachList = await base44.asServiceRole.entities.OutreachRequest.filter({ id: outreachId });
  const outreach = outreachList?.[0];
  if (!outreach) return;

  const updatedItems = (outreach.items || []).map(it => {
    const isMatch = itemId ? it.item_id === itemId : it.didit_session_id === sessionId;
    return isMatch ? { ...it, ...idvFields } : it;
  });
  await base44.asServiceRole.entities.OutreachRequest.update(outreachId, { items: updatedItems });

  console.log('diditWebhook: data.updated refreshed IDV fields', { sessionId });
}

// ── Terminal decision (Approved / Declined / In Review / Abandoned / Expired) ─
async function processTerminalDecisionImpl(base44, body) {
  const sessionId = body.session_id;
  let resolvedOutreachId = body.metadata?.outreach_id;
  let resolvedItemId     = body.metadata?.item_id;
  const resolvedTenantId = body.metadata?.tenant_id;

  // Fallback: metadata missing/malformed — locate by session_id within the tenant's requests.
  if (!resolvedOutreachId && resolvedTenantId) {
    const candidates = await base44.asServiceRole.entities.OutreachRequest.filter({ tenant_id: resolvedTenantId });
    const match = (candidates || []).find(r => (r.items || []).some(i => i.didit_session_id === sessionId));
    if (match) {
      resolvedOutreachId = match.id;
      resolvedItemId     = match.items.find(i => i.didit_session_id === sessionId)?.item_id;
    }
  }

  if (!resolvedOutreachId || !resolvedTenantId) {
    console.warn('diditWebhook: could not resolve outreach/tenant for session', sessionId);
    return;
  }

  const outreachList = await base44.asServiceRole.entities.OutreachRequest.filter({ id: resolvedOutreachId });
  const outreach = outreachList?.[0];
  if (!outreach) { console.warn('diditWebhook: outreach not found', resolvedOutreachId); return; }

  const existingItem = (outreach.items || []).find(i =>
    resolvedItemId ? i.item_id === resolvedItemId : i.didit_session_id === sessionId
  );
  if (existingItem?.idv_status && existingItem.idv_status !== 'Pending' && existingItem.didit_session_id === sessionId) {
    console.log('diditWebhook: already processed, skipping', { sessionId });
    return;
  }

  const tenants = await base44.asServiceRole.entities.Tenant.filter({ id: resolvedTenantId });
  const tenant  = tenants?.[0];
  if (!tenant?.didit_api_key) { console.warn('diditWebhook: no Didit API key for tenant', resolvedTenantId); return; }

  const result = await fetchDiditDecision(sessionId, tenant.didit_api_key);
  if (result.pending || !result.idvFields) { console.log('diditWebhook: decision not yet terminal', sessionId); return; }

  const { decision, idvFields } = result;

  const freshOutreach = (await base44.asServiceRole.entities.OutreachRequest.filter({ id: resolvedOutreachId }))?.[0];
  if (!freshOutreach) return;

  const updatedItems = (freshOutreach.items || []).map(it => {
    const isMatch = resolvedItemId ? it.item_id === resolvedItemId : it.didit_session_id === sessionId;
    if (isMatch) return { ...it, ...idvFields, status: idvFields.idv_status === 'Pass' ? 'Received' : 'Requested' };
    return it;
  });
  await base44.asServiceRole.entities.OutreachRequest.update(resolvedOutreachId, { items: updatedItems });

  // Create Document records for the ID/selfie images (dedup-guarded on session_id).
  if (freshOutreach.client_id) {
    const root = decision?.decision || decision || {};
    const idv  = root.id_verifications?.[0] || {};
    await createIdvDocuments(base44, resolvedTenantId, freshOutreach.client_id, sessionId, idv, idvFields.idv_status);
  }

  const caseId = freshOutreach.case_id;
  if (caseId) {
    await autoCompleteSteps(base44, caseId, resolvedTenantId, freshOutreach.client_id, idvFields);
  }

  // Abandoned — notify analysts with both an alert and an audit event.
  if (body.status === 'Abandoned' && freshOutreach.client_id) {
    const clients = await base44.asServiceRole.entities.Client.filter({ id: freshOutreach.client_id });
    const client  = clients?.[0];
    await base44.asServiceRole.entities.MonitoringAlert.create({
      tenant_id:   resolvedTenantId,
      client_id:   freshOutreach.client_id,
      case_id:     caseId || null,
      entity_name: client?.full_name || freshOutreach.client_id,
      entity_type: 'Client',
      alert_type:  'Didit_Abandoned',
      source:      'Didit KYC',
      details:     { session_id: sessionId, reason: 'Abandoned' },
    }).catch(() => {});
  }

  await base44.asServiceRole.entities.AuditEvent.create({
    tenant_id:  resolvedTenantId,
    case_id:    caseId || null,
    client_id:  freshOutreach.client_id,
    actor_type: 'System',
    actor_name: 'Didit Webhook',
    event_type: 'didit_webhook_processed',
    notes:      `Didit webhook: ${body.status}. Session ${sessionId}. Event ${body.event_id || 'n/a'}. IDV status: ${idvFields.idv_status}. AML hits: ${idvFields.idv_aml_hits}.`,
  }).catch(() => {});

  console.log('diditWebhook: processed', { sessionId, idv_status: idvFields.idv_status });
}

async function createIdvDocuments(base44, tenantId, clientId, sessionId, idv, idvStatus) {
  try {
    const existingDocs  = await base44.asServiceRole.entities.Document.filter({ didit_session_id: sessionId, is_deleted: false });
    const existingTypes = new Set((existingDocs || []).map((d) => d.doc_type));
    const docType       = (idv.document_type || '').toLowerCase().includes('passport') ? 'Passport' : 'ID_Card';
    const reviewStatus  = idvStatus === 'Pass' ? 'Approved' : 'Pending_Review';

    if (idv.front_image && !existingTypes.has(docType)) {
      await base44.asServiceRole.entities.Document.create({
        tenant_id: tenantId, client_id: clientId, doc_type: docType,
        file_name: `Didit_${docType}_Front_${sessionId.substring(0, 8)}.jpg`,
        file_url: idv.front_image, version: 1, is_ai_generated: false,
        review_status: reviewStatus, source: 'didit', didit_session_id: sessionId,
      }).catch(() => {});
    }
    if (idv.portrait_image && !existingTypes.has('Selfie')) {
      await base44.asServiceRole.entities.Document.create({
        tenant_id: tenantId, client_id: clientId, doc_type: 'Selfie',
        file_name: `Didit_Selfie_${sessionId.substring(0, 8)}.jpg`,
        file_url: idv.portrait_image, version: 1, is_ai_generated: false,
        review_status: 'Approved', source: 'didit', didit_session_id: sessionId,
      }).catch(() => {});
    }
  } catch (e) {
    console.error('diditWebhook createIdvDocuments failed:', e?.message);
  }
}

async function autoCompleteSteps(base44, caseId, tenantId, clientId, idvFields) {
  const caseList = await base44.asServiceRole.entities.KycCase.filter({ id: caseId });
  const kycCase  = caseList?.[0];
  if (!kycCase) return;

  const updates    = {};
  const auditNotes = [];

  if (idvFields.idv_status === 'Pass' && kycCase.step_2_status !== 'complete') {
    updates.step_2_status = 'complete';
    auditNotes.push(`Step 2 auto-completed via Didit webhook (score: ${idvFields.idv_similarity_score ?? '?'}%).`);
  }

  if (idvFields.idv_aml_hits === 0 && kycCase.step_3_status !== 'complete') {
    const existingHits = await base44.asServiceRole.entities.ScreeningHit.filter({ case_id: caseId });
    const activeHits = (existingHits || []).filter(h => !['Discounted'].includes(h.status));
    if (activeHits.length === 0) {
      updates.step_3_status = 'complete';
      auditNotes.push('Step 3 auto-completed: Didit AML returned 0 hits.');
    }
  }

  const allCaseOutreaches = await base44.asServiceRole.entities.OutreachRequest.filter({ case_id: caseId });
  const allItemsDone = (allCaseOutreaches || []).every(req => {
    const countable = (req.items || []).filter(i => i.field_type !== 'section_header');
    return countable.length > 0 && countable.every(i => ['Received', 'Verified'].includes(i.status));
  });
  const hasIdvPass = (allCaseOutreaches || []).some(req =>
    (req.items || []).some(i => i.idv_status === 'Pass')
  );
  if (allItemsDone && hasIdvPass && kycCase.step_1_status !== 'complete') {
    updates.step_1_status = 'complete';
    auditNotes.push('Step 1 auto-completed: all outreach items received and IDV passed.');
  }

  if (Object.keys(updates).length > 0) {
    await base44.asServiceRole.entities.KycCase.update(caseId, updates);
    await base44.asServiceRole.entities.AuditEvent.create({
      tenant_id:  tenantId,
      case_id:    caseId,
      client_id:  clientId,
      actor_type: 'System',
      actor_name: 'Didit Webhook',
      event_type: 'steps_auto_completed',
      notes:      auditNotes.join(' '),
    }).catch(() => {});
  }
}

// ── Resubmitted — reviewer asked the user to redo specific steps ─────────────
async function handleResubmitted(base44, tenantId, body) {
  const outreachId = body.metadata?.outreach_id;
  const sessionId   = body.session_id;
  if (!outreachId) return;

  const outreachList = await base44.asServiceRole.entities.OutreachRequest.filter({ id: outreachId });
  const outreach = outreachList?.[0];
  if (!outreach) return;

  const resubmitNodes = body.resubmit_info?.nodes_to_resubmit || [];
  const updatedItems = (outreach.items || []).map(it => {
    const matches = it.didit_session_id === sessionId ||
      (body.metadata?.item_id && it.item_id === body.metadata.item_id);
    if (matches) {
      return {
        ...it,
        status: 'Requested',
        idv_status: 'Pending',
        didit_session_id: '',
        didit_session_url: '',
        didit_session_status: 'Resubmitted',
      };
    }
    return it;
  });
  await base44.asServiceRole.entities.OutreachRequest.update(outreachId, { items: updatedItems });

  await base44.asServiceRole.entities.AuditEvent.create({
    tenant_id:  tenantId,
    case_id:    outreach.case_id || null,
    client_id:  outreach.client_id,
    actor_type: 'System',
    actor_name: 'Didit Webhook',
    event_type: 'didit_resubmission_requested',
    notes:      `Didit requested resubmission for session ${sessionId}. Nodes: ${resubmitNodes.join(', ') || 'n/a'}. Reasons: ${JSON.stringify(body.resubmit_info?.reasons || {})}`,
  }).catch(() => {});
}

// ── Kyc Expired — verified user's KYC has aged out per retention policy ──────
async function handleKycExpired(base44, tenantId, body) {
  const clientId = body.vendor_data;
  if (!clientId || !tenantId) return;

  const clients = await base44.asServiceRole.entities.Client.filter({ id: clientId });
  const client  = clients?.[0];

  await base44.asServiceRole.entities.MonitoringAlert.create({
    tenant_id:   tenantId,
    client_id:   clientId,
    entity_name: client?.full_name || clientId,
    entity_type: 'Client',
    alert_type:  'Didit_Ongoing_High_Risk',
    source:      'Didit KYC Expiry',
    details:     { session_id: body.session_id, reason: 'Kyc Expired' },
  }).catch(() => {});

  await base44.asServiceRole.entities.AuditEvent.create({
    tenant_id:  tenantId,
    client_id:  clientId,
    actor_type: 'System',
    actor_name: 'Didit Webhook',
    event_type: 'didit_kyc_expired',
    notes:      `Client's Didit KYC verification has expired (session ${body.session_id}). Reverification recommended.`,
  }).catch(() => {});
}

// ── Ongoing AML monitoring (user.status.updated) ─────────────────────────────
async function handleOngoingMonitoring(base44, tenantId, body) {
  const clientId = body.vendor_data;
  if (!clientId || !tenantId) return;

  const decision = body.decision || {};
  const aml   = (decision.aml_screenings || [])[0] || {};
  const hits  = aml.hits || [];

  let alertType = null;
  if (hits.some(h => h.sanction_matches?.length))      alertType = 'Didit_Ongoing_Sanctions';
  else if (hits.some(h => h.pep_matches?.length))       alertType = 'Didit_Ongoing_PEP';
  else if (hits.some(h => h.adverse_media_matches?.length)) alertType = 'Didit_Ongoing_Adverse_Media';
  else if ((aml.total_hits ?? 0) > 0)                   alertType = 'Didit_Ongoing_High_Risk';

  if (!alertType) return;

  const clients = await base44.asServiceRole.entities.Client.filter({ id: clientId });
  const client  = clients?.[0];

  await base44.asServiceRole.entities.MonitoringAlert.create({
    tenant_id:   tenantId,
    client_id:   clientId,
    entity_name: client?.full_name || clientId,
    entity_type: 'Client',
    alert_type:  alertType,
    source:      'Didit Ongoing Monitoring',
    details:     { session_id: body.session_id, aml_total_hits: aml.total_hits, hits },
  }).catch(() => {});

  await base44.asServiceRole.entities.AuditEvent.create({
    tenant_id:  tenantId,
    client_id:  clientId,
    actor_type: 'System',
    actor_name: 'Didit Ongoing Monitoring',
    event_type: 'didit_ongoing_monitoring_alert',
    notes:      `Ongoing AML monitoring flagged ${alertType} for client. Session ${body.session_id}.`,
  }).catch(() => {});
}