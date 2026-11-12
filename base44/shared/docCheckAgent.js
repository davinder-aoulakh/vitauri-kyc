// AI Document Checker Agent — authenticity check of a client-uploaded document (portal / analyst upload).
// Deterministic forensics (docForensics.js) + an AI review of the file against what was requested and the client's
// KYC data. It never rejects. A high-risk verdict notifies the case analyst and flags step 1. When the tenant switched on
// tm_settings.doc_check_auto_approve, a document without any red flag is approved by the agent (audited); otherwise advisory.
// Logs to AiAgentRun (redacted) and AuditEvent. No Didit calls.
import { asList } from './tmAuth.js';
import { analyseBytes, combineVerdict, scoreOf } from './docForensics.js';
import { aiLogFields } from './aiLog.js';
import { normName } from './declinedMatch.js';

export const CHECK_VERSION = '2';
const MAX_BYTES = 20 * 1024 * 1024;
const AI_TYPES = ['pdf', 'png', 'jpg', 'webp'];

/** Documents the agent checks: the client's own uploads, not Didit copies, reports or AI output. */
export function isCheckable(doc) {
  if (!doc || doc.is_deleted || !doc.file_url) return false;
  if (['didit', 'didit_kyb'].includes(doc.source)) return false;
  if (doc.is_ai_generated || doc.doc_type === 'KYC_Report') return false;
  if (String(doc.file_name || '').startsWith('Didit_Verification_Report_')) return false;
  return true;
}

async function sha256(buf) {
  const h = await crypto.subtle.digest('SHA-256', buf);
  return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function fileUrlFor(base44, fileUrl) {
  if (/^https?:\/\//i.test(fileUrl)) return fileUrl;
  const r = await base44.asServiceRole.integrations.Core.CreateFileSignedUrl({ file_uri: fileUrl, expires_in: 600 });
  return r?.signed_url;
}

const DEFAULT_PROMPT = `You are a KYC document examiner. Judge whether the attached document is an authentic, unaltered and fitting document for what was requested, for this client. Be factual: only report what you can see. Look for: document type vs. what was requested; issuer and date; name / address / registration number vs. the client's KYC data; validity (proof of address usually <= 3 months old, registry extract <= 6 months, ID not expired); signs of editing (inconsistent fonts, misaligned text, pasted or blurred areas, altered numbers, mismatching backgrounds), missing pages or cut-off content, a screenshot or photo of a screen where an original was expected. Consider the file forensics given. Never invent issues; if the document looks normal say so.
Calibration: (1) a deed of incorporation / articles normally carry NO trade-register number (the company is registered afterwards): never flag that. (2) Documents the client makes itself (organisation chart, structure description, declarations) are judged on whether their content is consistent with the client data, not on issuer formality or creating software. (3) A document older than the requested age is a 'warn' named "Document age", never a 'fail'. (4) Ignore formatting differences in addresses and names (order, spacing, initials vs full first names). (5) Do not judge file re-use; that is handled separately. (6) Use 'fail' only for a real mismatch of identity (different person or company), a wrong document type, or visible tampering; say exactly what you saw.
Ownership and control: when the document shows shareholders, UBOs, directors or ownership percentages, list them in "ownership" and compare them with the RELATED PARTIES ON FILE; add one check with id "ownership_control" (pass when they agree, warn when they differ or someone is missing, info when the document does not cover it).
key_points: 1-4 short statements of what this document PROVES for the KYC file (e.g. "Confirms J. Jansen as 100% shareholder and sole director; matches the UBO on file", "Confirms the registered address"). Start the summary with the most important one.`;

const SCHEMA = {
  type: 'object',
  properties: {
    document_type_detected: { type: 'string' },
    matches_request: { type: 'boolean' },
    issuer: { type: 'string' },
    document_date: { type: 'string' },
    ownership: { type: 'array', items: { type: 'object', properties: { name: { type: 'string' }, role: { type: 'string' }, percentage: { type: 'string' } } } },
    key_points: { type: 'array', items: { type: 'string' } },
    extracted: { type: 'object', properties: { name: { type: 'string' }, address: { type: 'string' }, registration_number: { type: 'string' }, date_of_birth: { type: 'string' } } },
    checks: {
      type: 'array',
      items: { type: 'object', properties: { id: { type: 'string' }, label: { type: 'string' }, result: { type: 'string', enum: ['pass', 'warn', 'fail', 'info'] }, detail: { type: 'string' } } },
    },
    summary: { type: 'string' },
    verdict: { type: 'string', enum: ['authentic', 'needs_attention', 'high_risk'] },
    confidence: { type: 'number' },
  },
};

async function invoke(base44, payload) {
  try {
    return await base44.asServiceRole.integrations.Core.InvokeLLM({ ...payload, model: 'gemini_3_1_pro' });
  } catch (e) {
    console.warn('DocumentCheck: preferred model failed, using default:', e?.message);
    return await base44.asServiceRole.integrations.Core.InvokeLLM(payload);
  }
}

function clientFacts(client) {
  const c = client || {};
  const addr = c.residential_address && typeof c.residential_address === 'object'
    ? [c.residential_address.street, c.residential_address.number, c.residential_address.zipcode, c.residential_address.city, c.residential_address.country].filter(Boolean).join(' ')
    : '';
  return [
    `Client type: ${c.client_type || 'NP'}`,
    `Name: ${c.full_name || '—'}`,
    c.client_type === 'ORG' ? `Registration number: ${c.registration_number || '—'}` : `Date of birth: ${c.date_of_birth || '—'}`,
    `Address on file: ${addr || c.registered_address || '—'}`,
    `Country: ${c.registered_country || c.country_of_residence || c.nationality || '—'}`,
  ].join('\n');
}

/** Related parties on file (UBOs, directors, shareholders) for the ownership comparison. */
async function relatedPartiesOf(E, tenantId, clientId) {
  const links = asList(await E.ClientRelatedPartyLink.filter({ tenant_id: tenantId, client_id: clientId }).catch(() => []));
  if (!links.length) return [];
  const rps = asList(await E.RelatedParty.filter({ tenant_id: tenantId, id: { $in: links.map((l) => l.related_party_id) } }).catch(() => []));
  return links.map((l) => {
    const p = rps.find((r) => r.id === l.related_party_id);
    return p ? { name: p.full_name, date_of_birth: p.date_of_birth || null, role: l.role || (l.roles || []).join(', ') || p.role_in_relationship || '', ownership: l.ownership_percentage ?? p.ownership_percentage ?? null } : null;
  }).filter(Boolean);
}

/**
 * Who else holds the identical file? Pure. Returns { unrelated: [names], sameSubject: [names], linked: [text], sameClient: n }.
 * - a twin on a deleted / missing client record is ignored (a removed duplicate of a file is not re-use);
 * - same subject: another client record of the same company (registration number or name) or person (name + date of birth);
 * - linked: the other client is a related party of this client, or this client is a person linked to that company.
 */
export function classifyTwins({ doc, client, twins = [], clients = [], relatedParties = [], otherLinks = [] }) {
  const out = { unrelated: [], sameSubject: [], linked: [], sameClient: twins.filter((d) => d.client_id === doc.client_id).length };
  const reg = (v) => String(v || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  const me = { name: normName(client?.full_name), reg: reg(client?.registration_number), dob: String(client?.date_of_birth || '').slice(0, 10), org: client?.client_type === 'ORG' };
  const rpNames = new Set(relatedParties.map((p) => normName(p.name)).filter(Boolean));
  for (const id of [...new Set(twins.filter((d) => d.client_id && d.client_id !== doc.client_id).map((d) => d.client_id))]) {
    const o = clients.find((c) => c.id === id);
    if (!o || o.is_deleted) continue;
    const oName = normName(o.full_name);
    const oOrg = o.client_type === 'ORG';
    const same = me.org === oOrg && ((me.org && me.reg && me.reg === reg(o.registration_number)) || (oName && oName === me.name && (me.org || !me.dob || !o.date_of_birth || me.dob === String(o.date_of_birth).slice(0, 10))));
    if (same) { out.sameSubject.push(o.full_name); continue; }
    // This client's UBO/director is that client, or that company lists this person as a related party.
    if (rpNames.has(oName)) { out.linked.push(`${o.full_name} (related party of this client)`); continue; }
    if (otherLinks.some((l) => l.client_id === id && normName(l.name) === me.name)) { out.linked.push(`${o.full_name} (this client is a related party there)`); continue; }
    out.unrelated.push(o.full_name || 'another client');
  }
  return out;
}

/** What was asked for this document (the outreach item it answered), when we can tell. */
async function requestedFor(E, doc) {
  if (!doc.case_id) return null;
  const reqs = asList(await E.OutreachRequest.filter({ case_id: doc.case_id }).catch(() => []));
  for (const r of reqs) {
    const it = (r.items || []).find((i) => i.file_url && i.file_url === doc.file_url) || (r.items || []).find((i) => i.label && i.label === doc.file_name);
    if (it) return { label: it.label, description: String(it.description || '').replace(/<[^>]*>/g, '').slice(0, 300) };
  }
  return null;
}

/**
 * Check one document. ctx: { base44, E, tenant, actor: { id, name, type } }. Returns the stored ai_check.
 */
export async function checkDocument(ctx, doc) {
  const { base44, E, tenant } = ctx;
  const runAt = new Date().toISOString();
  try {
    const url = await fileUrlFor(base44, doc.file_url);
    if (!url) throw new Error('file not reachable');
    const res = await fetch(url);
    if (!res.ok) throw new Error(`download ${res.status}`);
    const buf = new Uint8Array(await res.arrayBuffer());
    if (buf.byteLength > MAX_BYTES) throw new Error('file larger than 20 MB');
    const hash = await sha256(buf);

    // Same file elsewhere in the tenant
    const twins = asList(await E.Document.filter({ tenant_id: doc.tenant_id, file_sha256: hash }).catch(() => [])).filter((d) => d.id !== doc.id && !d.is_deleted);
    const otherClientIds = [...new Set(twins.filter((d) => d.client_id !== doc.client_id).map((d) => d.client_id))];
    const otherClients = otherClientIds.length ? asList(await E.Client.filter({ tenant_id: doc.tenant_id, id: { $in: otherClientIds } }).catch(() => [])) : [];
    const client = asList(await E.Client.filter({ id: doc.client_id }))[0] || {};
    const relatedParties = await relatedPartiesOf(E, doc.tenant_id, doc.client_id);
    // Is this client (a person) a related party on the other clients' files?
    let otherLinks = [];
    if (otherClients.length) {
      const ls = asList(await E.ClientRelatedPartyLink.filter({ tenant_id: doc.tenant_id, client_id: { $in: otherClients.map((c) => c.id) } }).catch(() => []));
      const ps = ls.length ? asList(await E.RelatedParty.filter({ tenant_id: doc.tenant_id, id: { $in: ls.map((l) => l.related_party_id) } }).catch(() => [])) : [];
      otherLinks = ls.map((l) => ({ client_id: l.client_id, name: ps.find((p) => p.id === l.related_party_id)?.full_name || '' }));
    }
    const reuse = classifyTwins({ doc, client, twins, clients: otherClients, relatedParties, otherLinks });

    const requested = await requestedFor(E, doc);
    const forensic = analyseBytes(buf, {
      fileName: doc.file_name, label: `${requested?.label || ''} ${doc.file_name || ''} ${doc.doc_type || ''}`, sha256: hash, reuse, isOrg: client.client_type === 'ORG',
    });

    let ai = null;
    let aiError = null;
    let promptVersion = 'default';
    if (AI_TYPES.includes(forensic.type)) {
      const cfg = asList(await E.AiPromptConfig.filter({ tenant_id: doc.tenant_id, agent_key: 'DocumentCheck' }).catch(() => [])).find((c) => c.is_active !== false && c.system_prompt);
      if (cfg) promptVersion = `tenant:${cfg.id}`;
      const prompt = `${cfg?.system_prompt || DEFAULT_PROMPT}

REQUESTED DOCUMENT: ${requested ? `${requested.label}${requested.description ? ` — ${requested.description}` : ''}` : doc.file_name}
CLIENT KYC DATA:
${clientFacts(client)}
RELATED PARTIES ON FILE (UBOs, directors, shareholders):
${relatedParties.length ? relatedParties.map((p) => `- ${p.name}${p.role ? ` — ${p.role}` : ''}${p.ownership != null && p.ownership !== '' ? ` — ${p.ownership}%` : ''}`).join('\n') : '- none recorded'}
TODAY: ${runAt.slice(0, 10)}
FILE FORENSICS (deterministic):
${forensic.checks.filter((c) => c.id !== 'file_reuse').map((c) => `- ${c.label}: ${c.result} — ${c.detail}`).join('\n')}

Return JSON only. checks: your own findings (content, consistency, validity, visual integrity); do not repeat the forensics.`;
      try {
        ai = await invoke(base44, { prompt, file_urls: [url], response_json_schema: SCHEMA });
        await E.AiAgentRun.create({
          tenant_id: doc.tenant_id, agent_type: 'DocumentCheck', case_id: doc.case_id || undefined, model_used: 'gemini_3_1_pro',
          prompt_version: promptVersion, sources: [`document:${doc.id}`], output_summary: String(ai?.summary || '').slice(0, 500),
          ...aiLogFields({ prompt, output: ai, tenant }),
        }).catch(() => {});
      } catch (e) {
        aiError = String(e?.message || e).slice(0, 200);
      }
    }

    const aiChecks = (ai?.checks || []).filter((c) => c && c.label && ['pass', 'warn', 'fail', 'info'].includes(c.result))
      .filter((c) => !/re-?use|reused|duplicate file/i.test(`${c.id || ''} ${c.label}`)) // re-use is judged by the file check only
      .slice(0, 15).map((c, i) => ({ id: c.id || `ai_${i}`, label: String(c.label).slice(0, 80), result: c.result, detail: String(c.detail || '').slice(0, 300), source: 'ai' }));
    if (ai && ai.matches_request === false) aiChecks.unshift({ id: 'ai_matches_request', label: 'Matches what was requested', result: 'warn', detail: `Looks like: ${ai.document_type_detected || 'a different document'}.`, source: 'ai' });
    // The same file on an unrelated client's file AND a name that does not match this client: a strong signal.
    const nameFail = aiChecks.some((c) => c.result === 'fail' && /name|entity|identity/i.test(`${c.id} ${c.label}`));
    const checks = [...forensic.checks.map((c) => ({ ...c, ...(c.id === 'file_reuse' && c.result === 'warn' && nameFail ? { result: 'fail', detail: `${c.detail} The name on the document does not match this client.` } : {}), source: 'file' })), ...aiChecks];
    const verdict = combineVerdict(checks, ai?.verdict);
    const result = {
      status: 'done', verdict, score: scoreOf(checks), summary: ai?.summary ? String(ai.summary).slice(0, 600) : (aiError ? `File checks only (AI review unavailable: ${aiError}).` : 'File checks only (format not suitable for AI review).'),
      checks, document_type_detected: ai?.document_type_detected || null, matches_request: ai?.matches_request ?? null,
      key_points: (ai?.key_points || []).filter(Boolean).slice(0, 4).map((k) => String(k).slice(0, 240)),
      ownership: (ai?.ownership || []).filter((o) => o && o.name).slice(0, 12).map((o) => ({ name: String(o.name).slice(0, 120), role: String(o.role || '').slice(0, 80), percentage: String(o.percentage || '').slice(0, 20) })),
      ai_reviewed: !!ai,
      extracted: ai?.extracted || null, issuer: ai?.issuer || null, document_date: ai?.document_date || null,
      file_type: forensic.type, run_at: runAt, model: ai ? 'gemini_3_1_pro' : null, version: CHECK_VERSION,
    };
    await E.Document.update(doc.id, { ai_check: result, file_sha256: hash });
    await afterCheck(ctx, doc, result);
    return result;
  } catch (e) {
    const result = { status: 'error', error: String(e?.message || e).slice(0, 200), run_at: runAt, version: CHECK_VERSION };
    await E.Document.update(doc.id, { ai_check: result }).catch(() => {});
    return result;
  }
}

// Audit, notification and the step-1 flag after a check.
async function afterCheck(ctx, doc, result) {
  const { E, actor } = ctx;
  const flagged = result.checks.filter((c) => c.result === 'fail' || c.result === 'warn').map((c) => c.label);
  await E.AuditEvent.create({
    tenant_id: doc.tenant_id, client_id: doc.client_id, case_id: doc.case_id || undefined,
    actor_user_id: actor?.id, actor_name: actor?.name || 'AI Document Checker', actor_type: actor?.type || 'AI_Agent', event_type: 'document_ai_check',
    before_state: {}, after_state: { document_id: doc.id, verdict: result.verdict, score: result.score, flagged_checks: flagged },
    notes: `AI Document Checker: ${doc.file_name} — ${result.verdict.replace('_', ' ')}${flagged.length ? ` (${flagged.join(', ')})` : ''}.`,
  }).catch(() => {});
  const kycCase = doc.case_id ? asList(await E.KycCase.filter({ id: doc.case_id }))[0] : null;
  const pending = (doc.review_status || 'Pending_Review') === 'Pending_Review' && !doc.reviewed_by_user_id;

  // Auto-approve (tenant switch): no red flag at all, the AI really looked at the file, and nobody reviewed it yet.
  let approved = false;
  if (ctx.tenant?.tm_settings?.doc_check_auto_approve === true && result.verdict === 'authentic' && result.ai_reviewed && pending) {
    const now = new Date().toISOString();
    await E.Document.update(doc.id, { review_status: 'Approved', review_notes: 'Approved by AI Document Checker — no red flags', reviewed_at: now });
    approved = true;
    // The outreach item this file answered is verified with it, so the analyst has nothing left to click.
    let item = null;
    if (doc.case_id) {
      const reqs = asList(await E.OutreachRequest.filter({ case_id: doc.case_id }).catch(() => []));
      for (const r of reqs) {
        const idx = (r.items || []).findIndex((i) => i.file_url && i.file_url === doc.file_url && i.status === 'Received');
        if (idx < 0) continue;
        const items = r.items.map((i, n) => (n === idx ? { ...i, status: 'Verified', verified_by: 'AI Document Checker', verified_at: now } : i));
        await E.OutreachRequest.update(r.id, { items }).catch((e) => console.warn('outreach verify', e?.message));
        item = r.items[idx].label;
        break;
      }
    }
    await E.AuditEvent.create({
      tenant_id: doc.tenant_id, client_id: doc.client_id, case_id: doc.case_id || undefined, actor_name: 'AI Document Checker', actor_type: 'AI_Agent',
      event_type: 'document_auto_approved', before_state: { review_status: doc.review_status || 'Pending_Review' }, after_state: { review_status: 'Approved', document_id: doc.id, score: result.score, outreach_item_verified: item },
      notes: `Document "${doc.file_name}" approved by the AI Document Checker: no red flags${(result.key_points || []).length ? ` — ${result.key_points[0]}` : ''}.`,
    }).catch(() => {});
  }

  // Step 1 is un-flagged when no high-risk document is left waiting for a review (after a re-check or an approval).
  if (kycCase?.step_1_status === 'flagged' && result.verdict !== 'high_risk') {
    const others = asList(await E.Document.filter({ case_id: kycCase.id }).catch(() => []))
      .filter((d) => d.id !== doc.id && !d.is_deleted && d.ai_check?.verdict === 'high_risk' && (d.review_status || 'Pending_Review') === 'Pending_Review');
    if (!others.length) {
      await E.KycCase.update(kycCase.id, { step_1_status: 'in_progress' });
      await E.AuditEvent.create({ tenant_id: doc.tenant_id, client_id: doc.client_id, case_id: kycCase.id, actor_name: 'AI Document Checker', actor_type: 'AI_Agent', event_type: 'step_1_unflagged',
        before_state: { step_1_status: 'flagged' }, after_state: { step_1_status: 'in_progress' }, notes: 'Step 1 flag removed: no high-risk document is waiting for review.' }).catch(() => {});
    }
  }
  if (approved || result.verdict === 'authentic' || doc.review_status === 'Approved' || doc.review_status === 'Rejected') return;

  let recipients = kycCase?.assigned_analyst_id ? [kycCase.assigned_analyst_id] : [];
  if (!recipients.length) {
    const users = asList(await E.User.filter({ tenant_id: doc.tenant_id }, undefined, 500).catch(() => []))
      .filter((u) => ['Manager', 'Tenant Admin', 'Compliance Officer'].includes(u.app_role || u.data?.app_role));
    recipients = users.map((u) => u.id).slice(0, 5);
  }
  const high = result.verdict === 'high_risk';
  for (const userId of recipients) {
    await E.Notification.create({
      tenant_id: doc.tenant_id, user_id: userId, type: 'document_check',
      title: high ? `High-risk document: ${doc.file_name}` : `Document needs attention: ${doc.file_name}`,
      body: result.summary, link_case_id: doc.case_id || undefined, link_client_id: doc.client_id,
      dedupe_key: `${userId}:${doc.id}:document_check:${result.verdict}`,
    }).catch(() => {});
  }
  if (high && kycCase && kycCase.step_1_status !== 'flagged') {
    await E.KycCase.update(kycCase.id, { step_1_status: 'flagged' });
    await E.AuditEvent.create({
      tenant_id: doc.tenant_id, client_id: doc.client_id, case_id: kycCase.id, actor_name: 'AI Document Checker', actor_type: 'AI_Agent',
      event_type: 'step_1_flagged', before_state: { step_1_status: kycCase.step_1_status || null }, after_state: { step_1_status: 'flagged', document_id: doc.id },
      notes: `Step 1 flagged: ${doc.file_name} was rated high risk by the AI Document Checker. An analyst must review it.`,
    }).catch(() => {});
  }
}
