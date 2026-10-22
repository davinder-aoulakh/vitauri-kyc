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
 * A decision can hold several checks of one kind (retries, extra documents).
 * Primary = the latest Approved entry, otherwise the last entry.
 */
export function primaryCheck(arr) {
  const list = Array.isArray(arr) ? arr.filter(Boolean) : [];
  if (list.length === 0) return {};
  for (let i = list.length - 1; i >= 0; i--) if (list[i].status === 'Approved') return list[i];
  return list[list.length - 1];
}

const AML_STATUS_RANK = { Declined: 3, 'In Review': 2, Approved: 1 };

/** Worst AML status across all screenings (Declined > In Review > Approved). */
function worstAmlStatus(list) {
  let worst = null;
  for (const s of list) {
    if (!s?.status) continue;
    if (!worst || (AML_STATUS_RANK[s.status] || 0) > (AML_STATUS_RANK[worst] || 0)) worst = s.status;
  }
  return worst;
}

/**
 * Given a raw Didit decision response, extract structured idvFields.
 * All entries of each check array are considered (see primaryCheck and the aggregates below).
 */
export function extractIdvFields(decision, sessionId) {
  const root = decision?.decision || decision || {};
  const idvs  = Array.isArray(root.id_verifications) ? root.id_verifications.filter(Boolean) : [];
  const faces = Array.isArray(root.face_matches)     ? root.face_matches.filter(Boolean)     : [];
  const lives = Array.isArray(root.liveness_checks)  ? root.liveness_checks.filter(Boolean)  : [];
  const amls  = Array.isArray(root.aml_screenings)   ? root.aml_screenings.filter(Boolean)   : [];
  const idv  = primaryCheck(idvs);
  const face = primaryCheck(faces);
  const live = primaryCheck(lives);
  const aml  = primaryCheck(amls);

  const warnings = [
    ...idvs.flatMap((c) => c.warnings || []),
    ...faces.flatMap((c) => c.warnings || []),
    ...lives.flatMap((c) => c.warnings || []),
  ];
  const faceScores = faces.map((c) => c.score).filter((s) => s != null);
  const amlHits = amls.reduce((n, s) => n + (Number(s.total_hits) || 0), 0);
  const failureReason = warnings.length > 0
    ? warnings.map(w => w.risk || w.short_description).filter(Boolean).join('; ')
    : null;

  return {
    didit_session_id:           sessionId,
    didit_session_status:       decision.status,
    idv_status:                 STATUS_MAP[decision.status] || 'Inconclusive',
    idv_similarity_score:       faceScores.length ? Math.round(Math.min(...faceScores)) : null,
    idv_liveness_passed:        lives.length > 0 && lives.every((c) => c.status === 'Approved'),
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
    idv_aml_hits:               amlHits,
    idv_aml_status:             worstAmlStatus(amls),
    idv_aml_screenings:         root.aml_screenings   || null,
    // AML warnings / risk codes (PEP_MATCH, SANCTIONED_ENTITY, ADVERSE_MEDIA_HIT, etc.)
    idv_aml_warnings:           amls.flatMap((s) => s.warnings || []),
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