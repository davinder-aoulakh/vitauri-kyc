// outreachUpload — public: a client's document for the current upload step of a guided conversation (spec 6.3, contract 4).
// Access is the link token alone (as outreachPortal); the flag is not checked, so a sent link keeps working.
// Body: { token, step_id, file: { name, mime, data (base64) } }
// The file is stored privately (UploadPrivateFile), recorded as OutreachEvidence and as a Document of the client (Pending
// review, so the classic step and the AI Document Checker see it), then checked: rules (age, name, address) plus the platform
// LLM for the other checks. If the AI fails, those checks are "Pending manual review" and the conversation continues.
// Returns { evidence_id, checks }. The answer itself goes through outreachPortal 'answer' with { evidence_id }.
// Phase 9: { token, open_request_id, file } answers an open request (analyst document request, or deferred evidence),
// also after submission: evidence + Document + checks, request answered, the analyst's confirmation in the thread,
// doc.checked + request.answered. { token, open_request_id, defer: true } keeps it open ("I will provide this later").
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.52';
import { asList, errorResponse, httpError } from '../../shared/tmAuth.js';
import { looksLikeToken, hashToken, linkState, createAttemptLimiter } from '../../shared/outreachToken.js';
import { outreachAuditRow, writeOutreachAudit } from '../../shared/outreachAudit.js';
import { sniffType } from '../../shared/docForensics.js';
import { normaliseChecks, ruleChecks, combineChecks, evidenceStatus } from '../../shared/outreachDocRules.js';
import { checkDocumentAi } from '../../shared/outreachDocAi.js';
import { MESSAGES } from '../../shared/outreachMessages.js';
import { fillPlaceholders } from '../../shared/outreachSnapshot.js';
import { appendMessages } from '../../shared/outreachThread.js';
import { answeredMessage } from '../../shared/outreachSecondRound.js';
import { applyMirror } from '../../shared/outreachMirror.js';

const limiter = createAttemptLimiter({ max: 20, windowMs: 15 * 60 * 1000 });
const NOT_FOUND = 'This link is not valid. Please use the link from your most recent email.';
const MAX_MB = 25;
const MIME = { pdf: 'application/pdf', jpg: 'image/jpeg', png: 'image/png' };
const DOC_TYPE = { payslip: 'Salary_Slip', sof_doc: 'Financial_Statement', wealth: 'Financial_Statement', doc_extract: 'Registry_Extract', doc_articles: 'Articles_of_Association' };

function clientIp(req) {
  const f = req.headers.get('x-forwarded-for') || '';
  return (f.split(',')[0] || req.headers.get('x-real-ip') || '').trim() || 'unknown';
}
function b64ToBytes(b64) {
  const clean = String(b64 || '').replace(/^data:[^;]+;base64,/, '');
  const bin = atob(clean);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
function addressText(a) { return a && typeof a === 'object' ? `${a.street || ''} ${a.number || ''}, ${a.postcode || ''} ${a.city || ''}, ${a.country || ''}`.trim() : ''; }

export default async function (req) {
  try {
    const base44 = createClientFromRequest(req);
    const body = await req.json().catch(() => ({}));
    const E = base44.asServiceRole.entities;
    const ip = clientIp(req);
    const token = String(body.token || '');
    if (limiter.blocked(`ip:${ip}`)) throw httpError(429, 'Too many attempts. Please wait a few minutes and try again.');
    if (!looksLikeToken(token)) { limiter.fail(`ip:${ip}`); throw httpError(404, NOT_FOUND); }
    const hash = await hashToken(token);
    const request = asList(await E.OutreachRequest.filter({ token_hash: hash }, undefined, 1))[0];
    if (!request || request.engine !== 'conversation') { limiter.fail(`ip:${ip}`); throw httpError(404, NOT_FOUND); }
    const conversation = request.conversation_id ? asList(await E.OutreachConversation.filter({ tenant_id: request.tenant_id, id: request.conversation_id }, undefined, 1))[0] : null;
    if (!conversation) throw httpError(404, NOT_FOUND);
    const link = linkState(request, conversation, new Date());
    const tenantId = conversation.tenant_id;
    const engine = conversation.pending_step?.engine || {};
    const conv0 = { id: conversation.id, request_id: request.id, case_id: conversation.case_id, client_id: conversation.client_id, party_id: conversation.party_id };
    const clientActor = { type: 'Client', name: conversation.invited_name || 'Client' };
    let step = null;
    let open = null;
    if (body.open_request_id) {
      if (link !== 'valid' && link !== 'submitted') throw httpError(409, MESSAGES.notCurrent);
      open = asList(await E.OutreachOpenRequest.filter({ tenant_id: tenantId, conversation_id: conversation.id, id: String(body.open_request_id) }, undefined, 1))[0] || null;
      const isDoc = open && (open.kind === 'deferred_evidence' || (open.kind === 'analyst_request' && (open.request_type || 'document') === 'document'));
      if (!open || open.status !== 'open' || !isDoc) throw httpError(409, MESSAGES.notCurrent);
      if (body.defer === true) {
        if (!open.deferred_at) await E.OutreachOpenRequest.update(open.id, { deferred_at: new Date().toISOString() });
        await appendMessages(E, { tenantId, conversationId: conversation.id, msgs: [
          { author_type: 'client', author_name: conversation.invited_name || '', kind: 'answer', text: MESSAGES.clientDeferred },
          { author_type: 'bank', kind: 'message', text: MESSAGES.requestDeferred },
        ] });
        await writeOutreachAudit(E, outreachAuditRow({ tenantId, event: 'request.deferred', actor: clientActor, conversation: conv0, payload: { open_request_id: open.id }, notes: `Deferred by the client: ${open.title}` }));
        return Response.json({ ok: true, deferred: true });
      }
      const blk = open.block_key ? conversation.blocks_snapshot?.[open.block_key] : null;
      step = { id: `request:${open.id}`, widget: 'upload', block_key: open.block_key || 'request', label: open.title, datapoint_key: open.block_key || 'request', checks: open.kind === 'deferred_evidence' ? (blk?.evidence?.checks || blk?.checks || []) : [] };
    } else {
      if (link !== 'valid' || conversation.submitted_at) throw httpError(409, MESSAGES.notCurrent);
      step = conversation.pending_step?.step || null;
      if (!step || step.widget !== 'upload' || String(body.step_id || '') !== step.id) throw httpError(409, MESSAGES.notCurrent);
    }
    const settings = conversation.settings_snapshot || {};

    const f = body.file || {};
    if (!f.data) throw httpError(400, MESSAGES.required);
    const approxBytes = Math.floor(String(f.data).length * 0.75);
    if (approxBytes > MAX_MB * 1024 * 1024) throw httpError(413, fillPlaceholders(MESSAGES.fileTooLarge, { mb: MAX_MB }));
    let bytes;
    try { bytes = b64ToBytes(f.data); } catch { throw httpError(400, MESSAGES.fileUnreadable); }
    if (bytes.length > MAX_MB * 1024 * 1024) throw httpError(413, fillPlaceholders(MESSAGES.fileTooLarge, { mb: MAX_MB }));
    const type = sniffType(bytes);
    if (!MIME[type]) throw httpError(415, MESSAGES.fileType);
    const name = String(f.name || `document.${type}`).replace(/[^\w .()-]/g, '_').slice(0, 150);
    const mime = MIME[type];

    const up = await base44.asServiceRole.integrations.Core.UploadPrivateFile({ file: new File([bytes], name, { type: mime }) });
    const fileUri = up?.file_uri;
    if (!fileUri) throw httpError(502, MESSAGES.fileUnreadable);

    const evidenceKey = `${step.block_key}${step.fu_id ? `:${step.fu_id}` : ''}`;
    const datapointKey = step.datapoint_key || step.fu_id || step.block_key;
    const label = step.label || conversation.blocks_snapshot?.[step.block_key]?.label || step.block_key;
    const doc = await E.Document.create({
      tenant_id: tenantId, client_id: conversation.client_id, case_id: conversation.case_id || undefined, ...(conversation.party_id ? { related_party_id: conversation.party_id } : {}),
      doc_type: DOC_TYPE[datapointKey] || 'Outreach_Response', file_name: `${label} — ${name}`.slice(0, 200), file_url: fileUri,
      source: 'outreach_conversation', review_status: 'Pending_Review', version: 1,
    }).catch((e) => { console.warn('Document create failed', e?.message); return null; });

    // Checks: rules for age / name / address, the AI for the rest.
    const checks = normaliseChecks(step.checks || [], settings);
    const today = new Date().toISOString();
    const context = { today, id_name: step.person || engine.datapoints?.full_name?.display || conversation.invited_name || '', address: engine.answers?.address || null, address_text: addressText(engine.answers?.address), max_age_months: settings.documentMaxAgeMonths || 3 };
    let ai = { ok: false, error: 'not run' };
    try {
      const signed = (await base44.asServiceRole.integrations.Core.CreateFileSignedUrl({ file_uri: fileUri, expires_in: 600 }))?.signed_url;
      const tenant = asList(await E.Tenant.filter({ id: tenantId }, undefined, 1))[0] || null;
      if (signed) {
        ai = await checkDocumentAi({
          invokeLLM: (p) => base44.asServiceRole.integrations.Core.InvokeLLM(p),
          log: (row) => E.AiAgentRun.create({ tenant_id: tenantId, case_id: conversation.case_id || undefined, sources: [`outreach_evidence:${evidenceKey}`], ...row }),
          tenant, signedUrl: signed, kind: datapointKey, label, checks, context, extract: !!step.read_extract,
        });
      }
    } catch (e) { ai = { ok: false, error: String(e?.message || e).slice(0, 200) }; }
    const rules = ruleChecks(checks, ai.ok ? ai.read : {}, context);
    const result = combineChecks(checks, ai, rules);
    const status = evidenceStatus(result);

    const ev = await E.OutreachEvidence.create({
      tenant_id: tenantId, conversation_id: conversation.id, block_key: evidenceKey, datapoint_key: datapointKey, file_uri: fileUri, document_id: doc?.id || undefined,
      name, size: bytes.length, mime, virus_scan: 'not_scanned', status, checks: result,
      read_result: ai.ok ? { ...ai.read, model_version: ai.model_version } : { error: ai.error || 'AI not available' }, kind: datapointKey, uploaded_at: today,
    });
    const conv = { id: conversation.id, request_id: request.id, case_id: conversation.case_id, client_id: conversation.client_id, party_id: conversation.party_id };
    await writeOutreachAudit(E, outreachAuditRow({
      tenantId, event: 'doc.uploaded', actor: { type: 'Client', name: conversation.invited_name || 'Client' }, conversation: conv,
      payload: { evidence_id: ev.id, document_id: doc?.id || null, block: evidenceKey, size: bytes.length, mime, status, ai_ok: !!ai.ok },
      payload_file: name, notes: `${label}: file uploaded (${Math.round(bytes.length / 1024)} KB)${ai.ok ? '' : '; AI check unavailable, pending manual review'}`,
    }));
    if (open) {
      const nowIso = new Date().toISOString();
      await E.OutreachOpenRequest.update(open.id, { status: 'answered', answered_at: nowIso, answer_evidence_id: ev.id });
      const tenant = asList(await E.Tenant.filter({ id: tenantId }, undefined, 1))[0] || null;
      const confirm = open.from_name ? answeredMessage({ name: open.from_name, role: open.from_role }) : { author_type: 'bank', kind: 'message', text: MESSAGES.analystReceived };
      await appendMessages(E, { tenantId, conversationId: conversation.id, tenantName: tenant?.name || '', msgs: [
        { author_type: 'client', author_name: conversation.invited_name || '', kind: 'answer', text: name, payload: { evidence_id: ev.id, open_request_id: open.id } },
        confirm,
      ] });
      await E.OutreachConversation.update(conversation.id, { last_activity_at: nowIso });
      if (conversation.submitted_at) await applyMirror(E, { conversation, request }).catch((e) => console.warn('mirror failed', e?.message)); // decision 10
      const passed = result.every((c) => c.ok !== false);
      await E.AuditEvent.bulkCreate([
        outreachAuditRow({ tenantId, event: 'doc.checked', actor: { type: 'System' }, conversation: conv, payload: { evidence_id: ev.id, open_request_id: open.id, checks: result.map((c) => ({ name: c.name, ok: c.ok })) }, notes: `request: ${open.title} — ${passed ? 'all checks passed' : 'some checks did not pass'}` }),
        outreachAuditRow({ tenantId, event: 'request.answered', actor: clientActor, conversation: conv, payload: { open_request_id: open.id, evidence_id: ev.id, file: name }, notes: 'Evidence received' }),
      ]).catch((e) => console.warn('audit failed', e?.message));
      const kc = conversation.case_id ? asList(await E.KycCase.filter({ tenant_id: tenantId, id: conversation.case_id }, undefined, 1))[0] : null;
      const uid = open.from_user_id || kc?.assigned_analyst_id;
      if (uid) await E.Notification.create({ tenant_id: tenantId, user_id: uid, type: 'outreach_response', is_read: false, title: `Document received: ${open.title}`, body: `${conversation.invited_name || 'The client'} uploaded ${name}.`, link_case_id: kc?.id, link_client_id: conversation.client_id, dedupe_key: `outreach_req:${open.id}` }).catch(() => {});
      return Response.json({ ok: true, evidence_id: ev.id, checks: result, status, answered: true });
    }
    return Response.json({ ok: true, evidence_id: ev.id, checks: result, status });
  } catch (error) {
    if (!error?.status || error.status >= 500) console.error('outreachUpload error:', error?.message);
    return errorResponse(error);
  }
}
