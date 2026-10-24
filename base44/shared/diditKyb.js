// Didit Business Verification (KYB): apply a business session decision to Vitauri, and handle business.* webhooks.
// Field names follow docs.didit.me/openapi-25.json (GET /v3/session/{id}/decision/ with session_kind 'business').
// Didit media URLs are short-lived presigned links: files are downloaded and re-stored privately, URLs are never persisted.
// Never touches the person (NP) KYC path.
import { asList } from './tmAuth.js';

const API = 'https://verification.didit.me';
export const SESSION_STATUSES = ['Not Started', 'In Progress', 'Awaiting User', 'In Review', 'Approved', 'Declined', 'Resubmitted', 'Abandoned', 'Expired', 'Kyc Expired'];
const DECIDED = ['Approved', 'Declined', 'In Review', 'Abandoned'];
const MAX_DOC_BYTES = 25 * 1024 * 1024;

/** GET the full decision for a session. Throws { status, detail } on HTTP errors. */
export async function fetchSessionDecision(tenant, sessionId) {
  if (!tenant?.didit_api_key) throw { status: 412, detail: 'Didit API key is not configured' };
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 20000);
  try {
    const res = await fetch(`${API}/v3/session/${encodeURIComponent(sessionId)}/decision/`, {
      headers: { 'x-api-key': tenant.didit_api_key, Accept: 'application/json' }, signal: ctrl.signal,
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw { status: res.status, detail: json?.detail || `Didit decision error ${res.status}` };
    return json;
  } finally {
    clearTimeout(timer);
  }
}

const lastWith = (arr, pred) => [...(Array.isArray(arr) ? arr : [])].reverse().find(pred) || null;
const clean = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== null && v !== ''));

function guessSource(text) {
  const t = String(text || '').toLowerCase();
  if (t.includes('pep') || t.includes('politically')) return 'PEP_List';
  if (/\bun\b/.test(t) || t.includes('united nations')) return 'Sanctions_UN';
  if (t.includes('sanction') || t.includes('ofac') || /\beu\b/.test(t)) return 'Sanctions_EU';
  if (t.includes('adverse') || t.includes('media')) return 'Adverse_Media';
  return 'Internal_Flag';
}

function docTypeFor(item) {
  const sub = String(item.document_subtype || '').toUpperCase();
  const grp = String(item.document_group || item.document_type || '').toUpperCase();
  if (/INCORPORATION|REGISTRY|REGISTER_EXTRACT|GOOD_STANDING|CHAMBER/.test(sub)) return 'Registry_Extract';
  if (/ARTICLE|MEMORANDUM|STATUTE|BYLAW/.test(sub)) return 'Articles_of_Association';
  if (/SHAREHOLDER|UBO|OWNERSHIP/.test(sub) || grp === 'OWNERSHIP_STRUCTURE') return 'UBO_Register';
  if (/FINANCIAL|ANNUAL_ACCOUNT/.test(sub)) return 'Financial_Statement';
  if (grp === 'LEGAL_PRESENCE') return 'Registry_Extract';
  return 'Other';
}

/** Officers / beneficial owners reported by the registry and key-people checks (no URLs kept). */
function keyPeopleFrom(company, keyPeopleChecks) {
  const out = [];
  for (const o of company?.officers || []) {
    out.push(clean({ source: 'registry_officer', name: o.name, first_name: o.first_name, last_name: o.last_name, role: o.role || o.designation, designation: o.designation, nationality: o.nationality, date_of_birth: o.date_of_birth, is_active: o.is_active, appointment_date: o.appointment_date, kyc_status: o.kyc_status }));
  }
  for (const b of company?.beneficial_owners || []) {
    out.push(clean({ source: 'beneficial_owner', name: b.name || b.company_name, first_name: b.first_name, last_name: b.last_name, entity_type: b.entity_type, role: 'ubo', ownership_percent: b.effective_ownership_percent ?? (b.ownership_min_shares != null ? Number(b.ownership_min_shares) : undefined), nationality: b.nationality, date_of_birth: b.date_of_birth, registration_number: b.registration_number, is_active: b.is_active, kyc_status: b.kyc_status }));
  }
  for (const chk of Array.isArray(keyPeopleChecks) ? keyPeopleChecks : []) {
    for (const o of chk?.registry?.officers || []) {
      const hit = out.find((p) => p.name && o.name && p.name.toLowerCase() === String(o.name).toLowerCase());
      const extra = clean({ kyc_status: o.kyc_status, aml_status: o.aml_status, kyc_session_id: o.kyc_session_id, kyc_verified_at: o.kyc_verified_at });
      if (hit) Object.assign(hit, extra);
      else out.push(clean({ source: 'key_people', name: o.name, role: o.role || o.designation, nationality: o.nationality, is_active: o.is_active, ...extra }));
    }
  }
  return out.slice(0, 100);
}

async function storeDocument(base44, ctx, kyb, item) {
  const url = String(item.file_url || '');
  if (!/^https:\/\//i.test(url)) return null;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`document download ${res.status}`);
  const buf = new Uint8Array(await res.arrayBuffer());
  if (buf.byteLength > MAX_DOC_BYTES) throw new Error('document too large');
  const name = String(item.original_filename || `${item.document_subtype || 'kyb-document'}-${item.uuid}`).slice(0, 180);
  const type = res.headers.get('content-type') || 'application/octet-stream';
  const up = await base44.asServiceRole.integrations.Core.UploadPrivateFile({ file: new File([buf], name, { type }) });
  if (!up?.file_uri) throw new Error('upload failed');
  const doc = await ctx.E.Document.create({
    tenant_id: ctx.tenantId, client_id: kyb.client_id, case_id: kyb.kyc_case_id || undefined,
    doc_type: docTypeFor(item), file_name: name, file_url: up.file_uri, source: 'didit_kyb', didit_session_id: kyb.didit_session_id,
  });
  return doc.id;
}

/**
 * Apply a KYB decision. ctx: { base44, E, tenantId, actor: { actorType, actorName, actorUserId } }.
 * Idempotent: documents and screening hits are deduped by their Didit ids. Returns the updated KybVerification fields.
 */
export async function applyKybDecision(ctx, kyb, decision, { eventId } = {}) {
  const { base44, E, tenantId, actor } = ctx;
  const status = SESSION_STATUSES.includes(decision?.status) ? decision.status : kyb.status;
  const regCheck = lastWith(decision?.registry_checks, (r) => r && r.company);
  const company = regCheck?.company || null;
  const patch = { status, checked_at: new Date().toISOString(), ...(eventId ? { last_event_id: eventId } : {}) };
  if (decision?.business_session_id) patch.business_session_id = decision.business_session_id;
  if (decision?.vendor_business_id) patch.vendor_business_id = decision.vendor_business_id;
  if (DECIDED.includes(status) && !kyb.decided_at) patch.decided_at = patch.checked_at;
  if (status === 'Resubmitted' && decision?.resubmit_info) patch.resubmit_info = decision.resubmit_info;

  // Registry: keep the company record (officer KYC links removed). Nothing is written to the Client here: like the
  // person ID&V path, registry values are offered in the Profile Verification grid / KYB card for the analyst to accept.
  if (company) {
    const { officers, beneficial_owners, ...rest } = company;
    patch.registry = { ...rest, officers_count: (officers || []).length, beneficial_owners_count: (beneficial_owners || []).length };
    patch.registry_status = company.registry_status || company.status || null;
    const isNew = JSON.stringify(patch.registry) !== JSON.stringify(kyb.registry || null);
    if (isNew) {
      await E.AuditEvent.create({
        tenant_id: tenantId, client_id: kyb.client_id, case_id: kyb.kyc_case_id || undefined, actor_user_id: actor?.actorUserId,
        actor_name: actor?.actorName || 'Didit KYB', actor_type: actor?.actorType || 'System', event_type: 'kyb_registry_received',
        before_state: {}, after_state: { kyb_verification_id: kyb.id, registry_status: patch.registry_status },
        notes: 'Didit KYB registry data received. Review and accept the company fields in Profile Verification.',
      });
    }
  }
  patch.key_people_found = keyPeopleFrom(company, decision?.key_people_checks);

  // Company documents: download and re-store privately (dedupe by Didit document uuid).
  const known = new Map((kyb.documents || []).map((d) => [d.didit_uuid, d]));
  const docs = [];
  for (const dv of Array.isArray(decision?.document_verifications) ? decision.document_verifications : []) {
    for (const it of dv?.items || []) {
      if (!it?.uuid || it.is_requested) continue;
      const prev = known.get(it.uuid);
      let documentId = prev?.document_id || null;
      let error = null;
      if (!documentId && it.file_url) {
        try { documentId = await storeDocument(base44, ctx, kyb, it); } catch (e) { error = String(e?.message || e).slice(0, 120); }
      }
      docs.push(clean({
        didit_uuid: it.uuid, document_group: it.document_group || it.document_type, document_subtype: it.document_subtype,
        status: it.status, original_filename: it.original_filename, document_id: documentId,
        is_tampered: it.document_metadata?.is_tampered ?? undefined, store_error: documentId ? undefined : error,
      }));
    }
  }
  for (const [uuid, d] of known) if (!docs.some((x) => x.didit_uuid === uuid)) docs.push(d);
  patch.documents = docs;

  // Company AML: one ScreeningHit per Didit hit (needs a case: ScreeningHit.case_id is required).
  const companyAml = (Array.isArray(decision?.aml_screenings) ? decision.aml_screenings : []).filter((a) => String(a?.entity_type || 'company').toLowerCase() !== 'person');
  const hitIds = [...(kyb.aml?.screening_hit_ids || [])];
  let totalHits = 0;
  for (const a of companyAml) {
    totalHits += a.total_hits || (a.hits || []).length;
    if (!kyb.kyc_case_id) continue;
    const existing = asList(await E.ScreeningHit.filter({ tenant_id: tenantId, case_id: kyb.kyc_case_id, entity_type: 'Client' }, undefined, 500));
    for (const h of a.hits || []) {
      if (!h?.id || existing.some((x) => x.hit_details?.didit_hit_id === h.id)) continue;
      const score = Math.round(h.match_score ?? (h.score != null ? (h.score <= 1 ? h.score * 100 : h.score) : 50));
      const rec = await E.ScreeningHit.create({
        tenant_id: tenantId, case_id: kyb.kyc_case_id, client_id: kyb.client_id, entity_name: company?.company_name || 'Company',
        entity_type: 'Client', source: guessSource((h.datasets || []).join(' ')), hit_name: h.caption || 'AML match',
        confidence_score: score, status: 'New',
        hit_details: { didit_hit_id: h.id, provider: 'Didit KYB', datasets: h.datasets || [], match_score: h.match_score ?? null, risk_score: h.risk_score ?? null, review_status: h.review_status || null, didit_session_id: kyb.didit_session_id },
        ai_rationale: `Didit KYB company AML: ${h.caption || 'match'} at ${score}% match.`,
      });
      hitIds.push(rec.id);
    }
  }
  patch.aml = { status: lastWith(companyAml, () => true)?.status || null, total_hits: totalHits, screening_hit_ids: hitIds, case_required: !kyb.kyc_case_id && totalHits > 0 };
  patch.feature_statuses = Object.fromEntries(['registry_checks', 'document_verifications', 'aml_screenings', 'key_people_checks']
    .map((k) => [k, (Array.isArray(decision?.[k]) ? decision[k] : []).map((x) => clean({ node_id: x?.node_id, status: x?.status }))]));

  await E.KybVerification.update(kyb.id, patch);

  // Outreach item status (portal shows it as completed once Didit has a decision to review).
  if (kyb.outreach_id && kyb.item_id) {
    const req = asList(await E.OutreachRequest.filter({ tenant_id: tenantId, id: kyb.outreach_id }, undefined, 1))[0];
    if (req) {
      const items = (req.items || []).map((i) => (i.item_id === kyb.item_id
        ? { ...i, kyb_verification_id: kyb.id, kyb_status: status, ...(['Approved', 'In Review'].includes(status) ? { status: 'Received' } : {}) }
        : i));
      await E.OutreachRequest.update(req.id, { items });
    }
  }

  if (status !== kyb.status || patch.documents.length !== (kyb.documents || []).length || hitIds.length !== (kyb.aml?.screening_hit_ids || []).length) {
    await E.AuditEvent.create({
      tenant_id: tenantId, client_id: kyb.client_id, case_id: kyb.kyc_case_id || undefined, actor_user_id: actor?.actorUserId,
      actor_name: actor?.actorName || 'Didit KYB', actor_type: actor?.actorType || 'System', event_type: 'kyb_decision_applied',
      before_state: { status: kyb.status || null }, after_state: { status, kyb_verification_id: kyb.id, documents: patch.documents.length, aml_hits: totalHits },
      notes: `Didit KYB ${status}: ${patch.documents.length} company document(s), ${totalHits} company AML hit(s).`,
    });
  }
  return { ...kyb, ...patch };
}

/** Ongoing business AML monitoring (business.status.updated / business.data.updated): mirrors the person path's alert. */
async function handleBusinessMonitoring(base44, tenantId, body) {
  const clientId = body.vendor_data;
  if (!clientId || !tenantId) return;
  const aml = (body.decision?.aml_screenings || [])[0] || {};
  const hits = aml.hits || [];
  let alertType = null;
  const has = (k) => hits.some((h) => (h?.[k] || []).length);
  const ds = (re) => hits.some((h) => (h?.datasets || []).some((d) => re.test(String(d))));
  if (has('sanction_matches') || ds(/sanction/i)) alertType = 'Didit_Ongoing_Sanctions';
  else if (has('pep_matches') || ds(/pep/i)) alertType = 'Didit_Ongoing_PEP';
  else if (has('adverse_media_matches') || ds(/adverse|media/i)) alertType = 'Didit_Ongoing_Adverse_Media';
  else if ((aml.total_hits ?? 0) > 0) alertType = 'Didit_Ongoing_High_Risk';
  if (!alertType) return;
  const E = base44.asServiceRole.entities;
  const client = asList(await E.Client.filter({ tenant_id: tenantId, id: clientId }, undefined, 1))[0];
  if (!client) return;
  await E.MonitoringAlert.create({
    tenant_id: tenantId, client_id: clientId, entity_name: client.full_name || clientId, entity_type: 'Client', alert_type: alertType,
    source: 'Didit Ongoing Business Monitoring', details: { webhook_type: body.webhook_type, aml_total_hits: aml.total_hits ?? hits.length, hit_id: hits[0]?.id || null },
  }).catch(() => {});
  await E.AuditEvent.create({
    tenant_id: tenantId, client_id: clientId, actor_type: 'System', actor_name: 'Didit Ongoing Business Monitoring',
    event_type: 'didit_ongoing_business_monitoring_alert', notes: `Ongoing business AML monitoring flagged ${alertType}.`,
  }).catch(() => {});
}

/**
 * Webhook entry for business sessions and business.* events (called from diditWebhook after signature + tenant checks).
 * tenant must carry Didit credentials (withDiditCredentials).
 */
export async function handleKybEvent(base44, tenant, body) {
  const E = base44.asServiceRole.entities;
  const tenantId = tenant.id;
  const type = String(body.webhook_type || '');
  if (type.startsWith('business.')) return handleBusinessMonitoring(base44, tenantId, body);

  const sessionId = body.session_id;
  if (!sessionId) return;
  const kyb = asList(await E.KybVerification.filter({ tenant_id: tenantId, didit_session_id: sessionId }, undefined, 1))[0];
  if (!kyb) {
    await E.AuditEvent.create({ tenant_id: tenantId, actor_type: 'System', actor_name: 'Didit KYB', event_type: 'kyb_webhook_unmatched', notes: `Business session ${sessionId} (${body.status}) has no KybVerification record.` }).catch(() => {});
    return;
  }
  if (body.event_id && kyb.last_event_id === body.event_id) return;
  const actor = { actorType: 'System', actorName: 'Didit KYB webhook' };
  const fetchFull = DECIDED.includes(body.status) || body.status === 'Resubmitted' || type === 'data.updated';
  if (!fetchFull) {
    if (SESSION_STATUSES.includes(body.status) && body.status !== kyb.status) {
      await E.KybVerification.update(kyb.id, { status: body.status, checked_at: new Date().toISOString(), ...(body.event_id ? { last_event_id: body.event_id } : {}) });
    }
    return;
  }
  let decision;
  try { decision = await fetchSessionDecision(tenant, sessionId); } catch { decision = { ...(body.decision || {}), status: body.status }; }
  await applyKybDecision({ base44, E, tenantId, actor }, kyb, decision, { eventId: body.event_id });
}
