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
import { fetchDiditDecision, primaryCheck } from '../../shared/diditDecision.js';
import { rehostDiditImage } from '../../shared/diditMedia.js';
import { verifyDiditSignature, isEventFresh } from '../../shared/diditWebhookVerify.js';
import { isTmEnabled } from '../../shared/tmGuards.js';
import { getTransaction as getDiditTmTransaction, normaliseTxnStatus } from '../../shared/diditTm.js';
import { afterTransactionUpdate } from '../../shared/diditTxnActions.js';
import { applyTxnDecision } from '../../shared/tmTxnDecision.js';
import { safeRecompute } from '../../shared/tmRisk.js';
import { withDiditCredentials } from '../../shared/diditCredentials.js';
import { handleKybEvent } from '../../shared/diditKyb.js';
import { applyRelatedPartyIdv, handleRelatedPartyMonitoring } from '../../shared/kybRelatedParty.js';

const NON_TERMINAL_STATUSES = ['Not Started', 'In Progress', 'Awaiting User'];
const TERMINAL_SESSION_STATUSES = ['Approved', 'Declined', 'In Review', 'Abandoned', 'Expired'];
// A 'received' event older than this is treated as a crashed run and may be processed again.
const STALE_RECEIVED_MS = 10 * 60 * 1000;

const rows = (res) => (Array.isArray(res) ? res : (res?.items || []));
const earliest = (list) => [...list].sort((a, b) =>
  String(a.created_date || '').localeCompare(String(b.created_date || '')) || String(a.id).localeCompare(String(b.id)))[0];

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
    //    Uses the SIGNED body field event.timestamp (the header is not covered by the signature); the body itself
    //    is verified against X-Signature-V2 below, so a changed timestamp fails the signature check.
    if (!isEventFresh(parsed, tsHeader)) {
      return Response.json({ error: 'stale or missing timestamp' }, { status: 401 });
    }

    const base44 = createClientFromRequest(req);
    let tenantId = parsed?.metadata?.tenant_id;

    // 2. Resolve the tenant. Session-level events carry metadata.tenant_id directly.
    //    User-level events (user.status.updated / user.data.updated) have no session
    //    metadata — resolve via the Client entity using vendor_data (client_id).
    //    Transaction events nest vendor_data under subject — check that too.
    let tenant = null;
    const vendorDataCandidate = parsed?.vendor_data || parsed?.subject?.vendor_data;
    if (tenantId) {
      const tenants = await base44.asServiceRole.entities.Tenant.filter({ id: tenantId });
      tenant = tenants?.[0] || null;
    } else if (vendorDataCandidate) {
      const clients = await base44.asServiceRole.entities.Client.filter({ id: vendorDataCandidate });
      const client = clients?.[0];
      if (client?.tenant_id) {
        tenantId = client.tenant_id;
        const tenants = await base44.asServiceRole.entities.Tenant.filter({ id: tenantId });
        tenant = tenants?.[0] || null;
      } else {
        // Didit KYB: a related party's own (UBO/director) verification uses the related party id as vendor_data.
        const parties = await base44.asServiceRole.entities.RelatedParty.filter({ id: vendorDataCandidate });
        if (parties?.[0]?.tenant_id) {
          tenantId = parties[0].tenant_id;
          const tenants = await base44.asServiceRole.entities.Tenant.filter({ id: tenantId });
          tenant = tenants?.[0] || null;
        }
      }
    }

    tenant = await withDiditCredentials(base44, tenant);

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

    // 4. Idempotency — dedupe on event_id. The record is written (awaited) before we reply and is marked
    //    processed only after processing succeeds, so a failed event can be delivered again and run.
    const eventId = parsed.event_id;
    let eventRowId = null;
    if (eventId && tenantId) {
      const EV = base44.asServiceRole.entities.DiditWebhookEvent;
      const nowIso = new Date().toISOString();
      const prior = earliest(rows(await EV.filter({ tenant_id: tenantId, event_id: eventId })));
      if (prior) {
        const state = prior.processing_state;
        const lastAt = Date.parse(prior.processed_at || prior.created_date || '') || 0;
        const retry = state === 'failed' || (state === 'received' && Date.now() - lastAt > STALE_RECEIVED_MS);
        if (!retry) return Response.json({ ok: true, duplicate: true });
        await EV.update(prior.id, { processing_state: 'received', attempts: (Number(prior.attempts) || 1) + 1, processed_at: nowIso, error: '' });
        eventRowId = prior.id;
      } else {
        const row = await EV.create({
          tenant_id:        tenantId,
          event_id:         eventId,
          session_id:       parsed.session_id,
          webhook_type:     parsed.webhook_type,
          status:           parsed.status,
          processed_at:     nowIso,
          processing_state: 'received',
          attempts:         1,
        });
        // Two deliveries racing: the earliest record wins, the other one is a duplicate.
        const first = earliest(rows(await EV.filter({ tenant_id: tenantId, event_id: eventId })));
        if (first && first.id !== row.id) {
          await EV.delete(row.id).catch(() => {});
          return Response.json({ ok: true, duplicate: true });
        }
        eventRowId = row.id;
      }
    }

    // 5. Respond immediately; process the event in the background and record the outcome.
    waitUntil(processAndRecord(base44, parsed, eventRowId));

    return Response.json({ ok: true, received: true });
  } catch (error) {
    console.error('diditWebhook error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
}

async function processAndRecord(base44, body, eventRowId) {
  const EV = base44.asServiceRole.entities.DiditWebhookEvent;
  try {
    await processWebhookEvent(base44, body);
    if (eventRowId) await EV.update(eventRowId, { processing_state: 'processed', processed_at: new Date().toISOString(), error: '' }).catch(() => {});
  } catch (err) {
    if (eventRowId) await EV.update(eventRowId, { processing_state: 'failed', error: String(err?.message || err).slice(0, 300) }).catch(() => {});
  }
}

async function processWebhookEvent(base44, body) {
  try {
    const tenantId    = body.metadata?.tenant_id;
    const status       = body.status;
    const webhookType  = body.webhook_type;

    // Didit KYB — business sessions and business.* events never enter the person (KYC) path.
    if (body.session_kind === 'business' || String(webhookType || '').startsWith('business.')) {
      const kybTenants = await base44.asServiceRole.entities.Tenant.filter({ id: tenantId });
      const kybTenant = await withDiditCredentials(base44, kybTenants?.[0]);
      if (kybTenant) await handleKybEvent(base44, kybTenant, body);
      return;
    }

    // Transaction monitoring (AML/KYT) — separate flow from KYC sessions.
    if (webhookType === 'transaction.created' || webhookType === 'transaction.status.updated') {
      await handleTransactionEvent(base44, tenantId, body);
      return;
    }

    // Ongoing monitoring — user-level (not session-level) events.
    if (webhookType === 'user.status.updated' || webhookType === 'user.data.updated') {
      // Didit KYB: vendor_data may be a related party (UBO/director) rather than a client.
      const party = body.vendor_data
        ? (await base44.asServiceRole.entities.RelatedParty.filter({ tenant_id: tenantId, id: body.vendor_data }))?.[0]
        : null;
      if (party) { await handleRelatedPartyMonitoring(base44, tenantId, party, body); return; }
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
    throw err;
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
  const tenant  = await withDiditCredentials(base44, tenants?.[0]);
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
  // Already decided: skip only when the status has not changed (In Review → Approved/Declined must still apply).
  const alreadyDecided = !!(existingItem?.idv_status && existingItem.idv_status !== 'Pending' && existingItem.didit_session_id === sessionId);
  if (alreadyDecided && existingItem.didit_session_status === body.status) {
    console.log('diditWebhook: already processed, skipping', { sessionId });
    return;
  }

  const tenants = await base44.asServiceRole.entities.Tenant.filter({ id: resolvedTenantId });
  const tenant  = await withDiditCredentials(base44, tenants?.[0]);
  if (!tenant?.didit_api_key) { console.warn('diditWebhook: no Didit API key for tenant', resolvedTenantId); return; }

  const result = await fetchDiditDecision(sessionId, tenant.didit_api_key);
  if (result.pending || !result.idvFields) { console.log('diditWebhook: decision not yet terminal', sessionId); return; }

  const { decision, idvFields } = result;

  // The stored status always comes from the live decision, so an out-of-order event cannot downgrade it.
  if (alreadyDecided && existingItem.didit_session_status === decision.status) {
    console.log('diditWebhook: live decision unchanged, skipping', { sessionId });
    return;
  }

  const freshOutreach = (await base44.asServiceRole.entities.OutreachRequest.filter({ id: resolvedOutreachId }))?.[0];
  if (!freshOutreach) return;

  if (alreadyDecided && existingItem.idv_status !== idvFields.idv_status) {
    // A Didit reviewer changed a decided session. Case steps are not reopened automatically.
    await base44.asServiceRole.entities.AuditEvent.create({
      tenant_id: resolvedTenantId, case_id: freshOutreach.case_id || null, client_id: freshOutreach.client_id,
      actor_type: 'System', actor_name: 'Didit Webhook', event_type: 'didit_decision_changed',
      before_state: { didit_session_status: existingItem.didit_session_status, idv_status: existingItem.idv_status },
      after_state: { didit_session_status: decision.status, idv_status: idvFields.idv_status },
      notes: `Didit decision for session ${sessionId} changed from ${existingItem.didit_session_status} to ${decision.status}. Review the case steps.`,
    }).catch(() => {});
  }

  const updatedItems = (freshOutreach.items || []).map(it => {
    const isMatch = resolvedItemId ? it.item_id === resolvedItemId : it.didit_session_id === sessionId;
    if (isMatch) return { ...it, ...idvFields, status: idvFields.idv_status === 'Pass' ? 'Received' : 'Requested' };
    return it;
  });
  await base44.asServiceRole.entities.OutreachRequest.update(resolvedOutreachId, { items: updatedItems });

  // Didit KYB: a related party's own verification updates the RelatedParty only. No company write-back,
  // no case-step auto-completion (the organisation's Entity Verification step is decided by KYB).
  if (freshOutreach.related_party_id && freshOutreach.tenant_id === resolvedTenantId) {
    const rpRoot = decision?.decision || decision || {};
    await applyRelatedPartyIdv(base44, { tenantId: resolvedTenantId, outreach: freshOutreach, sessionId, idvFields, amlScreenings: rpRoot.aml_screenings, actorName: 'Didit Webhook' });
    if (freshOutreach.client_id) {
      await createIdvDocuments(base44, resolvedTenantId, freshOutreach.client_id, sessionId, primaryCheck(rpRoot.id_verifications), idvFields.idv_status, { related_party_id: freshOutreach.related_party_id });
    }
    await base44.asServiceRole.entities.AuditEvent.create({
      tenant_id: resolvedTenantId, case_id: freshOutreach.case_id || null, client_id: freshOutreach.client_id, actor_type: 'System', actor_name: 'Didit Webhook',
      event_type: 'didit_webhook_processed', notes: `Didit webhook (related party): ${body.status}. Session ${sessionId}. Event ${body.event_id || 'n/a'}. IDV status: ${idvFields.idv_status}.`,
    }).catch(() => {});
    return;
  }

  // Create Document records for the ID/selfie images (dedup-guarded on session_id).
  if (freshOutreach.client_id) {
    const root = decision?.decision || decision || {};
    const idv  = primaryCheck(root.id_verifications);
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

async function createIdvDocuments(base44, tenantId, clientId, sessionId, idv, idvStatus, extra = {}) {
  try {
    const existingDocs  = await base44.asServiceRole.entities.Document.filter({ didit_session_id: sessionId, is_deleted: false });
    const existingTypes = new Set((existingDocs || []).map((d) => d.doc_type));
    const docType       = (idv.document_type || '').toLowerCase().includes('passport') ? 'Passport' : 'ID_Card';
    const reviewStatus  = idvStatus === 'Pass' ? 'Approved' : 'Pending_Review';

    // Didit image URLs expire: store a private copy; if that fails, skip (a later sync gets fresh URLs).
    if (idv.front_image && !existingTypes.has(docType)) {
      const fileName = `Didit_${docType}_Front_${sessionId.substring(0, 8)}.jpg`;
      const fileUri = await rehostDiditImage(base44, idv.front_image, fileName);
      if (fileUri) await base44.asServiceRole.entities.Document.create({
        tenant_id: tenantId, client_id: clientId, doc_type: docType,
        file_name: fileName,
        file_url: fileUri, version: 1, is_ai_generated: false,
        review_status: reviewStatus, source: 'didit', didit_session_id: sessionId, ...extra,
      }).catch(() => {});
    }
    if (idv.portrait_image && !existingTypes.has('Selfie')) {
      const fileName = `Didit_Selfie_${sessionId.substring(0, 8)}.jpg`;
      const fileUri = await rehostDiditImage(base44, idv.portrait_image, fileName);
      if (fileUri) await base44.asServiceRole.entities.Document.create({
        tenant_id: tenantId, client_id: clientId, doc_type: 'Selfie',
        file_name: fileName,
        file_url: fileUri, version: 1, is_ai_generated: false,
        review_status: 'Approved', source: 'didit', didit_session_id: sessionId, ...extra,
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

// ── Transaction monitoring (AML/KYT) status updates ──────────────────────────
async function handleTransactionEvent(base44, tenantId, body) {
  const diditTransactionId = body.transaction_id || body.id || body.uuid;
  const ourTransactionId   = body.metadata?.our_transaction_id || body.txn_id;
  if (!diditTransactionId && !ourTransactionId) {
    console.warn('diditWebhook: transaction event with no identifiable transaction id');
    return;
  }

  // Only this tenant's transactions (the tenant was resolved and its secret verified the signature)
  const scope = tenantId ? { tenant_id: tenantId } : {};
  let txList = [];
  if (diditTransactionId) {
    txList = await base44.asServiceRole.entities.Transaction.filter({ ...scope, didit_transaction_id: diditTransactionId });
  }
  if ((!txList || txList.length === 0) && ourTransactionId) {
    txList = await base44.asServiceRole.entities.Transaction.filter({ ...scope, our_transaction_id: ourTransactionId });
  }
  const txn = txList?.[0];
  if (!txn) {
    console.warn('diditWebhook: transaction event but no matching Transaction record', { diditTransactionId, ourTransactionId });
    return;
  }

  const tenantRec = await withDiditCredentials(base44, (await base44.asServiceRole.entities.Tenant.filter({ id: tenantId || txn.tenant_id }))?.[0]);
  if (tenantRec && isTmEnabled(tenantRec, 'tm_core')) {
    await tmTransactionEvent(base44, tenantRec, body, txn, diditTransactionId, ourTransactionId);
    return;
  }
  await legacyHandleTransactionEvent(base44, tenantId, body, txn, diditTransactionId, ourTransactionId);
}

// Original behaviour, unchanged — used when tm_core is not enabled for the tenant.
async function legacyHandleTransactionEvent(base44, tenantId, body, txn, diditTransactionId, ourTransactionId) {
  if (tenantId && txn.tenant_id !== tenantId) {
    console.warn('diditWebhook: transaction tenant mismatch (legacy) — ignoring', { txnId: txn.id });
    return;
  }
  const status    = body.status;
  const riskScore = body.risk_score ?? body.decision?.risk_score ?? txn.risk_score;
  const riskLevel = body.risk_level ?? body.decision?.risk_level ?? txn.risk_level;

  await base44.asServiceRole.entities.Transaction.update(txn.id, {
    status,
    risk_score: riskScore,
    risk_level: riskLevel,
    decision_raw: body,
  });

  if (status === 'DECLINED' || status === 'IN_REVIEW' || status === 'AWAITING_USER') {
    await base44.asServiceRole.entities.MonitoringAlert.create({
      tenant_id:   tenantId || txn.tenant_id,
      client_id:   txn.client_id,
      case_id:     txn.case_id || null,
      entity_name: txn.subject_full_name || txn.client_id,
      entity_type: 'Client',
      alert_type:  'Screening_Hit',
      source:      'Didit Transaction Monitoring',
      details: {
        transaction_id: txn.id,
        didit_transaction_id: diditTransactionId,
        status,
        risk_score: riskScore,
        risk_level: riskLevel,
      },
    }).catch(() => {});
  }

  await base44.asServiceRole.entities.AuditEvent.create({
    tenant_id:  tenantId || txn.tenant_id,
    case_id:    txn.case_id || null,
    client_id:  txn.client_id,
    actor_type: 'System',
    actor_name: 'Didit Webhook',
    event_type: 'didit_transaction_webhook',
    notes:      `Didit transaction webhook: ${status}. Transaction ${diditTransactionId || ourTransactionId}. Risk score: ${riskScore ?? 'n/a'}.`,
  }).catch(() => {});

  console.log('diditWebhook: transaction event processed', { diditTransactionId, status });
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
  let matchedHit = null;
  if (hits.some(h => h.sanction_matches?.length))      { alertType = 'Didit_Ongoing_Sanctions'; matchedHit = hits.find(h => h.sanction_matches?.length); }
  else if (hits.some(h => h.pep_matches?.length))       { alertType = 'Didit_Ongoing_PEP'; matchedHit = hits.find(h => h.pep_matches?.length); }
  else if (hits.some(h => h.adverse_media_matches?.length)) { alertType = 'Didit_Ongoing_Adverse_Media'; matchedHit = hits.find(h => h.adverse_media_matches?.length); }
  else if ((aml.total_hits ?? 0) > 0)                   { alertType = 'Didit_Ongoing_High_Risk'; matchedHit = hits[0] || null; }

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
    details:     {
      didit_session_id:   body.session_id,
      didit_screening_id: aml.id || aml.screening_id || null,
      hit_id:              matchedHit?.id || null,
      aml_total_hits:      aml.total_hits,
      hits,
    },
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

async function tmTransactionEvent(base44, tenant, body, txn, diditTransactionId, ourTransactionId) {
  const E = base44.asServiceRole.entities;
  const tenantId = tenant.id;
  if (txn.tenant_id !== tenantId) {
    console.warn('diditWebhook: transaction tenant mismatch — ignoring', { txnId: txn.id });
    return;
  }

  // a. Remember the event that last touched this transaction.
  if (body.event_id) {
    await E.Transaction.update(txn.id, { didit_last_event_id: body.event_id }).catch((e) => console.warn('diditWebhook: could not save event id', e?.message));
  }

  // b. Full record from Didit; fall back to the webhook body.
  let full = null;
  const lookupId = diditTransactionId || txn.didit_transaction_id;
  if (lookupId) {
    try {
      const res = await getDiditTmTransaction(tenant, lookupId);
      full = res?.transaction || res || null;
    } catch (e) {
      console.warn('diditWebhook: Didit GET transaction failed, using webhook body', { lookupId, error: e?.detail || e?.message || e });
    }
  } else {
    console.warn('diditWebhook: no Didit transaction id for GET, using webhook body');
  }
  const rec = full && typeof full === 'object' ? full : body;
  // c–e. Status, risk, rule runs, alert, blocking and audit: shared with the immediate decision at submission.
  await applyTxnDecision(base44, tenant, txn, rec, { body, diditTransactionId, ourTransactionId, actorName: 'Didit Webhook', waitUntilFn: waitUntil });
}

