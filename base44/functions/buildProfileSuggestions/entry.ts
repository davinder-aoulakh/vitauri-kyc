/**
 * buildProfileSuggestions
 * Orchestrates the Step 4 pre-fill pipeline:
 *  1. Fetch outreach responses for the case
 *  2. Fetch documents for the client and OCR-extract each
 *  3. Read/refresh OSINT cache
 *  4. Merge sources with conflict detection
 *  5. Persist to KycCase.profile_suggestions and return result
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

const CONFIDENCE_THRESHOLD = 70;

// NP fields we can extract from sources — includes dot-path keys for nested residential_address
const NP_FIELDS = [
  'full_name','first_names','last_name','initials','preferred_name','gender',
  'date_of_birth','country_of_birth','place_of_birth','nationality','country_of_residence',
  'id_type','id_number',
  'residential_address.country','residential_address.street','residential_address.number',
  'residential_address.zipcode','residential_address.city',
];
// ORG fields we can extract from sources
const ORG_FIELDS = ['full_name','legal_form','registration_number','registered_country','registered_address','sector','lei_code'];

// Source priority for merging (higher index = higher priority)
const SOURCE_PRIORITY = { osint: 0, outreach: 1, document: 2, didit: 3 };

function priorityOf(src: string): number {
  return SOURCE_PRIORITY[src] ?? 0;
}

// Merge multiple candidate values for a single field using priority + conflict detection
function mergeField(candidates: Array<{ value: string; confidence: number; source_type: string; source_ref: string; applied?: boolean; source_request_id?: string; source_item_id?: string }>) {
  if (!candidates || candidates.length === 0) return null;

  // Remove null/empty
  const valid = candidates.filter(c => c.value != null && String(c.value).trim() !== '');
  if (valid.length === 0) return null;

  // A candidate already applied to the client profile wins outright and is returned as a
  // durable 'confirmed' result — this is what stops the pipeline from re-prompting for it.
  const appliedCandidate = valid.find(c => c.applied);
  if (appliedCandidate) {
    return {
      value: appliedCandidate.value,
      confidence: appliedCandidate.confidence,
      source_type: appliedCandidate.source_type,
      source_ref: appliedCandidate.source_ref,
      status: 'confirmed',
      conflict_note: null,
      applied: true,
      source_request_id: appliedCandidate.source_request_id,
      source_item_id: appliedCandidate.source_item_id,
    };
  }

  if (valid.length === 1) {
    const c = valid[0];
    return {
      value: c.value,
      confidence: c.confidence,
      source_type: c.source_type,
      source_ref: c.source_ref,
      status: c.confidence >= CONFIDENCE_THRESHOLD ? 'suggested' : 'low_confidence',
      conflict_note: null,
      source_request_id: c.source_request_id,
      source_item_id: c.source_item_id,
    };
  }

  // Check for conflicts: normalise values for comparison
  const normalised = valid.map(c => String(c.value).toLowerCase().trim());
  const unique = [...new Set(normalised)];

  if (unique.length > 1) {
    // Conflict: list all sources
    const conflictNote = valid.map(c => `${c.source_type}(${c.source_ref}): "${c.value}"`).join(' vs ');
    // Pick highest-priority highest-confidence candidate as provisional value
    const best = [...valid].sort((a, b) => {
      const pd = priorityOf(b.source_type) - priorityOf(a.source_type);
      return pd !== 0 ? pd : b.confidence - a.confidence;
    })[0];
    return {
      value: best.value,
      confidence: best.confidence,
      source_type: best.source_type,
      source_ref: best.source_ref,
      status: 'conflict',
      conflict_note: conflictNote,
      source_request_id: best.source_request_id,
      source_item_id: best.source_item_id,
    };
  }

  // All sources agree — pick highest priority + confidence
  const best = [...valid].sort((a, b) => {
    const pd = priorityOf(b.source_type) - priorityOf(a.source_type);
    return pd !== 0 ? pd : b.confidence - a.confidence;
  })[0];
  return {
    value: best.value,
    confidence: best.confidence,
    source_type: best.source_type,
    source_ref: best.source_ref,
    status: best.confidence >= CONFIDENCE_THRESHOLD ? 'suggested' : 'low_confidence',
    conflict_note: null,
    source_request_id: best.source_request_id,
    source_item_id: best.source_item_id,
  };
}

const DIDIT_GENDER_MAP: Record<string, string> = { M: 'Male', F: 'Female', U: 'Other' };

function computeFullName(first?: string, last?: string): string {
  return [first, last].filter(Boolean).join(' ').trim();
}

// Build candidate map from Didit ID&V extraction on id_verification outreach items.
// Higher confidence/priority than generic outreach or document-OCR candidates — this is
// structured extraction directly from the verified ID document, not a label-matched answer
// or a generic OCR pass. NP only.
function extractFromDidit(outreaches: any[]): Record<string, any[]> {
  const candidates: Record<string, any[]> = {};

  const push = (field: string, value: string, ref: string, extra: Record<string, any> = {}) => {
    if (!value || String(value).trim() === '') return;
    if (!candidates[field]) candidates[field] = [];
    candidates[field].push({ value: String(value).trim(), confidence: 95, source_type: 'didit', source_ref: ref, ...extra });
  };

  for (const req of outreaches) {
    for (const item of (req.items || [])) {
      if (item.field_type !== 'id_verification') continue;
      const appliedFields = new Set(item.idv_profile_applied_fields || []);
      const sourceIds = { source_request_id: req.id, source_item_id: item.item_id };
      const ref = `Didit IDV: ${item.label}`;
      const nameApplied = (key: string) => appliedFields.has(key) || appliedFields.has('full_name');

      if (item.idv_extracted_first_name) push('first_names', item.idv_extracted_first_name, ref, { applied: nameApplied('first_names'), ...sourceIds });
      if (item.idv_extracted_last_name) push('last_name', item.idv_extracted_last_name, ref, { applied: nameApplied('last_name'), ...sourceIds });
      const fullName = computeFullName(item.idv_extracted_first_name, item.idv_extracted_last_name);
      if (fullName) push('full_name', fullName, ref, { applied: nameApplied('full_name'), ...sourceIds });
      if (item.idv_extracted_dob) push('date_of_birth', item.idv_extracted_dob, ref, { applied: appliedFields.has('date_of_birth'), ...sourceIds });
      if (item.idv_extracted_nationality) push('nationality', item.idv_extracted_nationality, ref, { applied: appliedFields.has('nationality'), ...sourceIds });
      if (item.idv_extracted_gender) {
        const mapped = DIDIT_GENDER_MAP[item.idv_extracted_gender] || null;
        if (mapped) push('gender', mapped, ref, { applied: appliedFields.has('gender'), ...sourceIds });
      }
      if (item.idv_extracted_address) push('residential_address.street', item.idv_extracted_address, ref, { applied: appliedFields.has('residential_address.street'), ...sourceIds });
    }
  }
  return candidates;
}

// Build candidate map from outreach responses
function extractFromOutreach(outreaches: any[], isOrg: boolean): Record<string, any[]> {
  const candidates: Record<string, any[]> = {};

  const push = (field: string, value: string, ref: string, confidence: number, sourceType = 'outreach', extra: Record<string, any> = {}) => {
    if (!value || String(value).trim() === '') return;
    if (!candidates[field]) candidates[field] = [];
    candidates[field].push({ value: String(value).trim(), confidence, source_type: sourceType, source_ref: ref, ...extra });
  };

  for (const req of outreaches) {
    for (const item of (req.items || [])) {
      const label = (item.label || '').toLowerCase();
      const val = item.response_text;
      if (!val || item.status === 'Requested') continue;
      const ref = `Outreach: ${item.label}`;

      if (!isOrg) {
        if (label.includes('full name') || label.includes('legal name')) push('full_name', val, ref, 80);
        if (label.includes('first name')) push('first_names', val, ref, 78);
        if (label.includes('last name') || label.includes('surname')) push('last_name', val, ref, 78);
        if (label.includes('initials')) push('initials', val, ref, 70);
        if (label.includes('preferred name')) push('preferred_name', val, ref, 70);
        if (label.includes('gender')) push('gender', val, ref, 70);
        if (label.includes('date of birth') || label.includes('dob')) push('date_of_birth', val, ref, 75);
        if (label.includes('country of birth') || label.includes('birth country')) push('country_of_birth', val, ref, 75);
        if (label.includes('place of birth') || label.includes('birth place')) push('place_of_birth', val, ref, 75);
        if (label.includes('nationalit')) push('nationality', val, ref, 75);
        if (label.includes('residence') || label.includes('country of residence')) push('country_of_residence', val, ref, 75);
        if (label.includes('id type') || label.includes('document type')) push('id_type', val, ref, 75);
        if (label.includes('id number') || label.includes('document number') || label.includes('passport')) push('id_number', val, ref, 75);
        if (label.includes('street') && !label.includes('postal')) push('residential_address.street', val, ref, 72);
        if (label.includes('house number') || label.includes('street number')) push('residential_address.number', val, ref, 70);
        if (label.includes('zipcode') || label.includes('postal code') || label.includes('zip code')) push('residential_address.zipcode', val, ref, 72);
        if (label.includes('city')) push('residential_address.city', val, ref, 72);
        if (label.includes('residential country')) push('residential_address.country', val, ref, 72);
      } else {
        if (label.includes('legal name') || label.includes('company name') || label.includes('full name')) push('full_name', val, ref, 80);
        if (label.includes('legal form') || label.includes('entity type')) push('legal_form', val, ref, 75);
        if (label.includes('registration') || label.includes('kvk') || label.includes('chamber')) push('registration_number', val, ref, 75);
        if (label.includes('country') || label.includes('jurisdiction')) push('registered_country', val, ref, 75);
        if (label.includes('address')) push('registered_address', val, ref, 70);
        if (label.includes('sector') || label.includes('industry')) push('sector', val, ref, 70);
        if (label.includes('lei')) push('lei_code', val, ref, 75);
      }
    }
  }
  return candidates;
}

// Build candidate map from OCR-extracted document fields
function extractFromOcr(ocrResults: Array<{ doc_id: string; file_name: string; extracted: any; field_confidence?: any }>, isOrg: boolean): { fieldCandidates: Record<string, any[]>; relatedPartyCandidates: any[] } {
  const candidates: Record<string, any[]> = {};
  const rpCandidates: any[] = [];

  const push = (field: string, value: any, docId: string, fileName: string, confidence: number) => {
    if (value == null || String(value).trim() === '') return;
    if (!candidates[field]) candidates[field] = [];
    candidates[field].push({
      value: String(value).trim(),
      confidence,
      source_type: 'document',
      source_ref: `${docId}::${fileName}`,
    });
  };

  for (const r of ocrResults) {
    const ex = r.extracted || {};
    const fc = r.field_confidence || {};
    const conf = (field: string, fallback: number) => fc[field] != null ? fc[field] : fallback;

    if (!isOrg) {
      push('full_name', ex.full_name, r.doc_id, r.file_name, conf('full_name', 90));
      push('first_names', ex.first_names, r.doc_id, r.file_name, conf('first_names', 88));
      push('last_name', ex.last_name, r.doc_id, r.file_name, conf('last_name', 88));
      push('gender', ex.gender, r.doc_id, r.file_name, conf('gender', 82));
      push('date_of_birth', ex.date_of_birth, r.doc_id, r.file_name, conf('date_of_birth', 90));
      push('country_of_birth', ex.country_of_birth, r.doc_id, r.file_name, conf('country_of_birth', 80));
      push('place_of_birth', ex.place_of_birth, r.doc_id, r.file_name, conf('place_of_birth', 80));
      push('nationality', ex.nationality, r.doc_id, r.file_name, conf('nationality', 88));
      push('country_of_residence', ex.address ? r.extracted.address : ex.country_of_issue, r.doc_id, r.file_name, conf('country_of_residence', 65));
      push('id_type', ex.id_type, r.doc_id, r.file_name, conf('id_type', 85));
      push('id_number', ex.id_number, r.doc_id, r.file_name, conf('id_number', 90));
    } else {
      push('full_name', ex.full_name, r.doc_id, r.file_name, conf('full_name', 88));
      push('legal_form', ex.legal_form, r.doc_id, r.file_name, conf('legal_form', 82));
      push('registration_number', ex.registration_number, r.doc_id, r.file_name, conf('registration_number', 90));
      push('registered_country', ex.registered_country, r.doc_id, r.file_name, conf('registered_country', 85));
      push('registered_address', ex.registered_address, r.doc_id, r.file_name, conf('registered_address', 80));
      push('sector', ex.sector, r.doc_id, r.file_name, conf('sector', 72));
      push('lei_code', ex.lei_code, r.doc_id, r.file_name, conf('lei_code', 88));

      // Related parties from ORG docs
      if (Array.isArray(ex.related_parties)) {
        for (const rp of ex.related_parties) {
          if (!rp.full_name) continue;
          rpCandidates.push({
            full_name: rp.full_name,
            party_type: 'NP',
            role_in_relationship: rp.role || 'Unknown',
            ownership_percentage: rp.ownership_percentage || null,
            source_ref: `${r.doc_id}::${r.file_name}`,
            confidence: rp.confidence || 75,
          });
        }
      }
    }
  }
  return { fieldCandidates: candidates, relatedPartyCandidates: rpCandidates };
}

// Build candidate map from OSINT cache findings
function extractFromOsint(osintResults: any, isOrg: boolean): Record<string, any[]> {
  const candidates: Record<string, any[]> = {};
  const findings = osintResults?.findings || [];

  const push = (field: string, value: string, finding: any, confidence: number) => {
    if (!value || String(value).trim() === '') return;
    if (!candidates[field]) candidates[field] = [];
    candidates[field].push({
      value: String(value).trim(),
      confidence,
      source_type: 'osint',
      source_ref: `${finding.title}::${finding.source_url || ''}`,
    });
  };

  for (const f of findings) {
    const summary = (f.summary || '').toLowerCase();
    const title = (f.title || '').toLowerCase();
    const credMult = f.credibility === 'high' ? 1.0 : f.credibility === 'medium' ? 0.85 : 0.65;

    if (isOrg) {
      // Extract sector from OSINT
      if (title.includes('sector') || summary.includes('sector') || summary.includes('industry') || summary.includes('financial services') || summary.includes('technology') || summary.includes('real estate')) {
        const sectorMatch = summary.match(/(?:operates in|active in|specialises in|sector[:\s]+)([a-z\s&,]+?)(?:\.|\s{2}|,\sand\s|$)/i);
        if (sectorMatch) push('sector', sectorMatch[1].trim(), f, Math.round(72 * credMult));
      }
      // Extract registration number if mentioned
      const regMatch = (f.summary || '').match(/(?:registered|registration|reg(?:\.?\s?no\.?)?)[:\s#]+([A-Z0-9]{5,20})/i);
      if (regMatch) push('registration_number', regMatch[1], f, Math.round(65 * credMult));
    } else {
      // NP: nationality occasionally mentioned
      const natMatch = summary.match(/(?:national of|citizen of|nationality[:\s]+)([a-z\s]+?)(?:\.|\s{2}|,|$)/i);
      if (natMatch) push('nationality', natMatch[1].trim(), f, Math.round(60 * credMult));
    }
  }
  return candidates;
}

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  const user = await base44.auth.me();
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  const { case_id, client_id, client_type, force_osint_refresh } = await req.json();
  if (!case_id || !client_id) return Response.json({ error: 'case_id and client_id are required' }, { status: 400 });

  const tenantId = user.tenant_id;
  const isOrg = client_type === 'ORG';

  // ── 1. Fetch outreach responses ──────────────────────────────────────────────
  const outreaches = await base44.asServiceRole.entities.OutreachRequest.filter({ case_id });
  const outreachCandidates = extractFromOutreach(outreaches || [], isOrg);

  // ── 2. Fetch documents + OCR each ────────────────────────────────────────────
  const docs = await base44.asServiceRole.entities.Document.filter({ client_id, tenant_id: tenantId });
  const activeDocs = (docs || []).filter((d: any) => !d.is_deleted && d.file_url);

  // Only OCR identity/incorporation docs — skip KYC_Report HTML exports
  const ocrableDocs = activeDocs.filter((d: any) => {
    if (d.doc_type === 'KYC_Report') return false;
    if (!isOrg && ['Passport','ID_Card','Selfie','Other'].includes(d.doc_type)) return true;
    if (isOrg && ['Articles_of_Association','UBO_Register','KYC_Report','Other','Financial_Statement'].includes(d.doc_type)) return true;
    return false;
  });

  const ocrResults: Array<{ doc_id: string; file_name: string; extracted: any; field_confidence: any }> = [];
  for (const doc of ocrableDocs.slice(0, 6)) { // cap at 6 to avoid runaway
    try {
      const ocrRes = await base44.asServiceRole.functions.invoke('ocrDocumentParse', {
        file_url: doc.file_url,
        doc_type: doc.doc_type,
        client_type,
      });
      const data = ocrRes?.data ?? ocrRes ?? {};
      if (data.extracted && Object.keys(data.extracted).length > 0) {
        ocrResults.push({
          doc_id: doc.id,
          file_name: doc.file_name,
          extracted: data.extracted,
          field_confidence: data.field_confidence || {},
        });
      }
    } catch (e) {
      console.warn('OCR failed for doc', doc.id, e);
    }
  }
  const { fieldCandidates: docCandidates, relatedPartyCandidates } = extractFromOcr(ocrResults, isOrg);

  // ── 3. OSINT ─────────────────────────────────────────────────────────────────
  const kycCaseArr = await base44.asServiceRole.entities.KycCase.filter({ id: case_id });
  const kycCase = kycCaseArr?.[0];
  const clientArr = await base44.asServiceRole.entities.Client.filter({ id: client_id });
  const clientRecord = clientArr?.[0];

  let osintResults = null;
  if (!force_osint_refresh && kycCase?.osint_cache) {
    try { osintResults = JSON.parse(kycCase.osint_cache)?.results; } catch {}
  }
  if (!osintResults || force_osint_refresh) {
    // Run fresh OSINT
    const name = clientRecord?.full_name || '';
    const country = clientRecord?.registered_country || clientRecord?.nationality || '';
    try {
      osintResults = await base44.asServiceRole.integrations.Core.InvokeLLM({
        prompt: `You are an OSINT analyst. Research "${name}" (${isOrg ? 'Organisation' : 'Natural Person'}, ${country}).
Report: official presence, corporate register data, sector, news, adverse media.
For each finding: title, summary (2-3 sentences), source_type, credibility (high/medium/low), source_url, is_adverse.
Return 4-6 findings. Be specific. If nothing found, say so clearly.`,
        add_context_from_internet: true,
        model: 'gemini_3_flash',
        response_json_schema: {
          type: 'object',
          properties: {
            entity_searched: { type: 'string' },
            overall_summary: { type: 'string' },
            adverse_count: { type: 'number' },
            findings: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  title: { type: 'string' },
                  summary: { type: 'string' },
                  source_type: { type: 'string' },
                  credibility: { type: 'string' },
                  source_url: { type: 'string' },
                  is_adverse: { type: 'boolean' },
                }
              }
            }
          }
        }
      });
      // Cache it
      await base44.asServiceRole.entities.KycCase.update(case_id, {
        osint_cache: JSON.stringify({ results: osintResults, run_at: new Date().toISOString() }),
      });
    } catch (e) {
      console.warn('OSINT search failed:', e);
    }
  }
  const osintCandidates = extractFromOsint(osintResults, isOrg);

  // ── 4. Merge all sources per field ────────────────────────────────────────────
  const allFields = isOrg ? ORG_FIELDS : NP_FIELDS;
  const clientFields: Record<string, any> = {};
  const diditCandidates = isOrg ? {} : extractFromDidit(outreaches || []);

  for (const field of allFields) {
    const merged: any[] = [
      ...(docCandidates[field] || []),
      ...(outreachCandidates[field] || []),
      ...(osintCandidates[field] || []),
      ...(diditCandidates[field] || []),
    ];
    const result = mergeField(merged);
    if (result) {
      clientFields[field] = result;
    } else {
      clientFields[field] = { value: null, confidence: 0, source_type: null, source_ref: null, status: 'missing', conflict_note: null };
    }
  }

  // ── 5. Deduplicate related party candidates ───────────────────────────────────
  const seenRp = new Set<string>();
  const uniqueRps = relatedPartyCandidates.filter(rp => {
    const key = rp.full_name.toLowerCase().trim();
    if (seenRp.has(key)) return false;
    seenRp.add(key);
    return true;
  }).map(rp => ({
    ...rp,
    fields: {
      full_name: { value: rp.full_name, confidence: rp.confidence, source_type: 'document', source_ref: rp.source_ref, status: rp.confidence >= CONFIDENCE_THRESHOLD ? 'suggested' : 'low_confidence', conflict_note: null },
      role_in_relationship: { value: rp.role_in_relationship, confidence: rp.confidence, source_type: 'document', source_ref: rp.source_ref, status: 'suggested', conflict_note: null },
      ownership_percentage: rp.ownership_percentage != null ? { value: String(rp.ownership_percentage), confidence: rp.confidence, source_type: 'document', source_ref: rp.source_ref, status: 'suggested', conflict_note: null } : null,
    },
    status: 'suggested',
    rp_id: null,
  }));

  // ── 6. Build sources_summary ──────────────────────────────────────────────────
  const sourcesSummary = {
    outreach_requests: outreaches?.length || 0,
    documents_processed: ocrResults.length,
    documents_skipped: ocrableDocs.length - ocrResults.length,
    osint_findings: osintResults?.findings?.length || 0,
    osint_adverse: osintResults?.adverse_count || 0,
  };

  const suggestion = {
    client_fields: clientFields,
    related_parties: uniqueRps,
    run_at: new Date().toISOString(),
    sources_summary: sourcesSummary,
    pipeline_running: false,
  };

  // Persist to KycCase
  await base44.asServiceRole.entities.KycCase.update(case_id, { profile_suggestions: suggestion });

  // Log audit event
  await base44.asServiceRole.entities.AuditEvent.create({
    tenant_id: tenantId,
    case_id,
    client_id,
    actor_user_id: user.id,
    actor_name: user.full_name,
    actor_type: 'AI_Agent',
    event_type: 'profile_pipeline_run',
    notes: `Pre-fill pipeline completed. ${ocrResults.length} docs OCR'd, ${osintResults?.findings?.length || 0} OSINT findings, ${Object.values(clientFields).filter((f:any) => f.status === 'suggested').length} fields suggested, ${Object.values(clientFields).filter((f:any) => f.status === 'conflict').length} conflicts detected.`,
  });

  return Response.json({ success: true, suggestion });
});