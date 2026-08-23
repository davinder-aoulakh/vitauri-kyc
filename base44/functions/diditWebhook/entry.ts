/**
 * Didit Webhook receiver.
 * Accepts POST from Didit for status.updated events.
 * Auth: shared token passed as ?token= query param (set as DIDIT_WEBHOOK_TOKEN app secret).
 * If no secret is configured, the endpoint still processes the event (open mode for testing).
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';
import { waitUntil } from 'base44:runtime';
import { fetchDiditDecision, TERMINAL_STATUSES } from '../../shared/diditDecision.js';

export default async function(req) {
  try {
    // No token guard configured — webhook is open (configure DIDIT_WEBHOOK_TOKEN secret to enable)

    const body = await req.json();
    const base44 = createClientFromRequest(req);

    // Didit sends { event_type, data: { session_id, status, vendor_data, ... } }
    const eventType = body.event_type || body.type;
    const data      = body.data || body;

    if (!['status.updated', 'session.updated', 'verification.completed'].includes(eventType)) {
      return Response.json({ ok: true, ignored: true });
    }

    const sessionId = data.session_id || data.id;
    const status    = data.status;

    if (!sessionId) return Response.json({ error: 'Missing session_id' }, { status: 400 });

    // Only process terminal statuses
    if (!TERMINAL_STATUSES.includes(status)) {
      return Response.json({ ok: true, status: 'not_terminal' });
    }

    // Respond immediately, do processing in background
    waitUntil(processWebhookEvent(base44, sessionId, status, data));

    return Response.json({ ok: true, received: true });
  } catch (error) {
    console.error('diditWebhook error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
}

async function processWebhookEvent(base44, sessionId, status, data) {
  try {
    // Find the OutreachRequest item that has this session_id
    // vendor_data may contain outreach_id and item_id passed during session creation
    const vendorData = (() => {
      try { return typeof data.vendor_data === 'string' ? JSON.parse(data.vendor_data) : (data.vendor_data || {}); }
      catch { return {}; }
    })();

    const outreachId = vendorData.outreach_id;
    const itemId     = vendorData.item_id;
    const tenantId   = vendorData.tenant_id;

    if (!outreachId || !tenantId) {
      console.warn('diditWebhook: missing vendor_data outreach_id/tenant_id, cannot process', { sessionId });
      return;
    }

    // Idempotency: check if this session has already been processed to a terminal state
    const outreachList = await base44.asServiceRole.entities.OutreachRequest.filter({ id: outreachId });
    const outreach = outreachList?.[0];
    if (!outreach) { console.warn('diditWebhook: outreach not found', outreachId); return; }

    const existingItem = (outreach.items || []).find(i => i.item_id === itemId || i.didit_session_id === sessionId);
    if (existingItem?.idv_status && existingItem.idv_status !== 'Pending') {
      console.log('diditWebhook: already processed, skipping', { sessionId, existingStatus: existingItem.idv_status });
      return;
    }

    // Fetch tenant API key
    const tenants = await base44.asServiceRole.entities.Tenant.filter({ id: tenantId });
    const tenant  = tenants?.[0];
    if (!tenant?.didit_api_key) { console.warn('diditWebhook: no Didit API key for tenant', tenantId); return; }

    // Fetch the decision from Didit
    const result = await fetchDiditDecision(sessionId, tenant.didit_api_key);
    if (result.pending || !result.idvFields) { console.log('diditWebhook: decision not yet terminal', sessionId); return; }

    const { idvFields } = result;

    // Update the OutreachRequest item with structured IDV fields
    const freshOutreach = (await base44.asServiceRole.entities.OutreachRequest.filter({ id: outreachId }))?.[0];
    if (!freshOutreach) return;

    const updatedItems = (freshOutreach.items || []).map(it => {
      const isMatch = itemId ? it.item_id === itemId : it.didit_session_id === sessionId;
      if (isMatch) return { ...it, ...idvFields, status: idvFields.idv_status === 'Pass' ? 'Received' : 'Requested' };
      return it;
    });
    await base44.asServiceRole.entities.OutreachRequest.update(outreachId, { items: updatedItems });

    // Auto-complete case steps if we have a case
    const caseId = freshOutreach.case_id;
    if (caseId) {
      await autoCompleteSteps(base44, caseId, tenantId, freshOutreach.client_id, idvFields, outreachId);
    }

    // Audit event
    await base44.asServiceRole.entities.AuditEvent.create({
      tenant_id:   tenantId,
      case_id:     caseId || null,
      client_id:   freshOutreach.client_id,
      actor_type:  'System',
      actor_name:  'Didit Webhook',
      event_type:  'didit_webhook_processed',
      notes:       `Didit webhook: ${status}. Session ${sessionId}. IDV status: ${idvFields.idv_status}. AML hits: ${idvFields.idv_aml_hits}.`,
    }).catch(() => {});

    console.log('diditWebhook: processed', { sessionId, idv_status: idvFields.idv_status });
  } catch (err) {
    console.error('diditWebhook processWebhookEvent error:', err);
  }
}

async function autoCompleteSteps(base44, caseId, tenantId, clientId, idvFields, processedOutreachId) {
  const caseList = await base44.asServiceRole.entities.KycCase.filter({ id: caseId });
  const kycCase  = caseList?.[0];
  if (!kycCase) return;

  const updates = {};
  const auditNotes = [];

  // Step 2 — auto-complete on IDV Pass
  if (idvFields.idv_status === 'Pass' && kycCase.step_2_status !== 'complete') {
    updates.step_2_status = 'complete';
    auditNotes.push(`Step 2 auto-completed via Didit webhook (score: ${idvFields.idv_similarity_score ?? '?'}%).`);
  }

  // Step 3 — auto-complete when AML is clear
  if (idvFields.idv_aml_hits === 0 && kycCase.step_3_status !== 'complete') {
    const existingHits = await base44.asServiceRole.entities.ScreeningHit.filter({ case_id: caseId });
    const activeHits = (existingHits || []).filter(h => !['Discounted'].includes(h.status));
    if (activeHits.length === 0) {
      updates.step_3_status = 'complete';
      auditNotes.push('Step 3 auto-completed: Didit AML returned 0 hits.');
    }
  }

  // Step 1 — auto-complete when all items on all case outreach requests are done
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