/**
 * Shared Didit decision mapping logic.
 * Used by getDiditSessionResult and diditWebhook.
 */

export function normaliseDateString(raw) {
  if (!raw) return null;
  const s = String(raw).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  if (/^\d{8}$/.test(s)) return `${s.slice(0,4)}-${s.slice(4,6)}-${s.slice(6,8)}`;
  const dmyMatch = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
  if (dmyMatch) {
    const [, d, m, y] = dmyMatch;
    return `${y}-${m.padStart(2,'0')}-${d.padStart(2,'0')}`;
  }
  return null;
}

export const STATUS_MAP = {
  Approved:        'Pass',
  Declined:        'Fail',
  'In Review':     'Inconclusive',
  Abandoned:       'Fail',
  Expired:         'Expired',
  Resubmitted:     'Inconclusive',
  'Kyc Expired':   'Expired',
  'Not Started':   'Pending',
  'In Progress':   'Pending',
  'Awaiting User': 'Pending',
};

// Statuses for which the /decision/ endpoint returns a usable decision payload.
export const TERMINAL_STATUSES = ['Approved', 'Declined', 'In Review', 'Abandoned', 'Expired', 'Resubmitted', 'Kyc Expired'];

// All literal V3 session status strings (exact, case-sensitive).
export const ALL_SESSION_STATUSES = [
  'Not Started', 'In Progress', 'Awaiting User', 'In Review', 'Approved',
  'Declined', 'Resubmitted', 'Abandoned', 'Expired', 'Kyc Expired',
];

export const ISO3_MAP = {
  'AUS':'Australia (AU)','NLD':'Netherlands (NL)','BEL':'Belgium (BE)',
  'DEU':'Germany (DE)','FRA':'France (FR)','GBR':'United Kingdom (GB)',
  'USA':'United States (US)','LUX':'Luxembourg (LU)','CHE':'Switzerland (CH)',
  'CAN':'Canada (CA)','NZL':'New Zealand (NZ)','SGP':'Singapore (SG)',
  'ZAF':'South Africa (ZA)','IND':'India (IN)','CHN':'China (CN)',
  'JPN':'Japan (JP)','ARE':'United Arab Emirates (AE)','BRA':'Brazil (BR)',
  'ARG':'Argentina (AR)','MYS':'Malaysia (MY)','PHL':'Philippines (PH)',
  'IDN':'Indonesia (ID)','THA':'Thailand (TH)','KOR':'South Korea (KR)',
  'PAK':'Pakistan (PK)','BGD':'Bangladesh (BD)','NGA':'Nigeria (NG)',
  'KEN':'Kenya (KE)','GHA':'Ghana (GH)','EGY':'Egypt (EG)',
  'TUR':'Turkey (TR)','ISR':'Israel (IL)','SAU':'Saudi Arabia (SA)',
  'QAT':'Qatar (QA)','KWT':'Kuwait (KW)','PRT':'Portugal (PT)',
  'ESP':'Spain (ES)','ITA':'Italy (IT)','SWE':'Sweden (SE)',
  'NOR':'Norway (NO)','DNK':'Denmark (DK)','FIN':'Finland (FI)',
  'IRL':'Ireland (IE)','POL':'Poland (PL)','CZE':'Czech Republic (CZ)',
  'HUN':'Hungary (HU)','ROU':'Romania (RO)','GRC':'Greece (GR)',
};

/**
 * Given a raw Didit decision response, extract structured idvFields.
 */
export function extractIdvFields(decision, sessionId) {
  const root = decision?.decision || decision || {};
  const idv  = root.id_verifications?.[0]  || {};
  const face = root.face_matches?.[0]       || {};
  const live = root.liveness_checks?.[0]    || {};
  const aml  = root.aml_screenings?.[0]     || {};

  const warnings = [
    ...(idv.warnings  || []),
    ...(face.warnings || []),
    ...(live.warnings || []),
  ];
  const failureReason = warnings.length > 0
    ? warnings.map(w => w.risk || w.short_description).filter(Boolean).join('; ')
    : null;

  return {
    didit_session_id:           sessionId,
    didit_session_status:       decision.status,
    idv_status:                 STATUS_MAP[decision.status] || 'Inconclusive',
    idv_similarity_score:       face.score    != null ? Math.round(face.score) : null,
    idv_liveness_passed:        live.status === 'Approved',
    idv_liveness_score:         live.score    != null ? Math.round(live.score) : null,
    idv_document_type:          idv.document_type     || null,
    idv_document_number:        idv.document_number   || null,
    idv_document_expiry:        normaliseDateString(idv.expiration_date)   || null,
    idv_extracted_first_name:   idv.first_name        || null,
    idv_extracted_last_name:    idv.last_name         || null,
    idv_extracted_dob:          normaliseDateString(idv.date_of_birth)     || null,
    idv_extracted_nationality:  idv.nationality       || null,
    idv_extracted_gender:       idv.gender            || null,
    idv_extracted_address:      idv.address           || null,
    idv_issuing_country:        idv.issuing_state     || null,
    idv_failure_reason:         failureReason,
    idv_aml_hits:               aml.total_hits        != null ? aml.total_hits : 0,
    idv_aml_status:             aml.status            || null,
    idv_aml_screenings:         root.aml_screenings   || null,
    // AML warnings / risk codes (PEP_MATCH, SANCTIONED_ENTITY, ADVERSE_MEDIA_HIT, etc.)
    idv_aml_warnings:           aml.warnings          || [],
    // Scoring thresholds & weights from the workflow config embedded in the screening result
    idv_aml_match_threshold:    aml.aml_match_score_threshold    ?? null,
    idv_aml_approve_threshold:  aml.aml_score_approve_threshold  ?? null,
    idv_aml_review_threshold:   aml.aml_score_review_threshold   ?? null,
    idv_aml_name_weight:        aml.aml_name_weight              ?? null,
    idv_aml_dob_weight:         aml.aml_dob_weight               ?? null,
    idv_aml_country_weight:     aml.aml_country_weight           ?? null,
    // Flags
    idv_aml_adverse_media:      aml.include_adverse_media        ?? false,
    idv_aml_ongoing_monitoring: aml.include_ongoing_monitoring   ?? false,
    idv_checked_at:             new Date().toISOString(),
    idv_provider:               'didit',
    // Raw face/liveness objects for rich rendering
    idv_face_raw:               face.score != null ? { score: face.score, status: face.status } : null,
    idv_liveness_raw:           live.score != null ? { score: live.score, status: live.status } : null,
  };
}

/**
 * Fetch the Didit decision for a session, returning { decision, idvFields } or null if not terminal.
 */
export async function fetchDiditDecision(sessionId, apiKey) {
  const response = await fetch(
    `https://verification.didit.me/v3/session/${sessionId}/decision/`,
    { headers: { 'x-api-key': apiKey } }
  );

  if (!response.ok) {
    if (response.status === 404) return { pending: true };
    throw new Error(`Didit API error: ${response.status}`);
  }

  const decision = await response.json();

  if (!TERMINAL_STATUSES.includes(decision.status)) {
    return { pending: true };
  }

  return { decision, idvFields: extractIdvFields(decision, sessionId) };
}