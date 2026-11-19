// Guided conversation outreach: the Didit ID&V step (spec 5.2 `idv`, adapter contract 3). Pure: reads the carrier's `idv`
// item as the Didit functions (createDiditSession, getDiditSessionResult, diditWebhook) store it; never calls Didit.
import { ISO3_MAP } from './diditDecision.js';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** "1987-03-14" -> "14 March 1987" (no time zone shift). */
export function longDate(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''));
  if (!m) return '';
  return `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]} ${m[1]}`;
}

/** ISO 3166 alpha-3 -> country name ("NLD" -> "Netherlands"); unknown codes stay as they are. */
export function countryName(code) {
  const c = String(code || '').trim();
  if (!c) return '';
  const hit = ISO3_MAP[c.toUpperCase()];
  return hit ? hit.replace(/\s*\([A-Z]{2}\)\s*$/, '') : c;
}

const titleCase = (s) => String(s || '').replace(/_/g, ' ').toLowerCase().replace(/(^|\s)\S/g, (x) => x.toUpperCase());

/** The four datapoints of the idv block from the stored Didit result. */
export function idvFromItem(item) {
  const i = item || {};
  const full = [i.idv_extracted_first_name, i.idv_extracted_last_name].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
  const type = titleCase(i.idv_document_type || 'Identity document');
  const doc = [type, i.idv_issuing_country ? String(i.idv_issuing_country).toUpperCase() : ''].filter(Boolean).join(' ');
  const exp = longDate(i.idv_document_expiry);
  return {
    full_name: full,
    dob: longDate(i.idv_extracted_dob),
    nat: countryName(i.idv_extracted_nationality),
    doc: exp ? `${doc}, valid until ${exp}` : doc,
  };
}

/** The four checks the client sees after the session (spec 5.2). */
export function idvChecks(item) {
  const i = item || {};
  const approved = i.idv_status === 'Pass';
  const notExpired = !i.idv_document_expiry || String(i.idv_document_expiry).slice(0, 10) >= new Date().toISOString().slice(0, 10);
  return [
    { key: 'document_read', label: 'ID document read', ok: !!(i.idv_document_number || i.idv_extracted_last_name) },
    { key: 'liveness', label: 'Selfie and liveness checked', ok: i.idv_liveness_passed === true },
    { key: 'face_match', label: 'Face matches document', ok: approved || (i.idv_similarity_score != null && Number(i.idv_similarity_score) >= 70) },
    { key: 'document_valid', label: 'Document is genuine and valid', ok: approved && notExpired },
  ];
}

const DONE_BAD = ['Fail', 'Expired'];

/**
 * Where the ID step stands. attempts = sessions started in this conversation.
 * Returns { state: 'none'|'open'|'approved'|'in_review'|'declined'|'expired', session_url?, can_start, attempts_left }.
 */
export function idvState(item, { attempts = 0, maxAttempts = 3 } = {}) {
  const i = item || {};
  const left = Math.max(0, maxAttempts - attempts);
  const sessionStatus = String(i.didit_session_status || '');
  if (i.idv_status === 'Pass') return { state: 'approved', can_start: false, attempts_left: left };
  if (i.idv_status === 'Inconclusive' && i.didit_session_id && sessionStatus !== 'Not Started' && sessionStatus !== 'In Progress') return { state: 'in_review', can_start: false, attempts_left: left };
  if (DONE_BAD.includes(i.idv_status)) {
    const expired = i.idv_status === 'Expired' || /expired|abandoned/i.test(sessionStatus);
    return { state: expired ? 'expired' : 'declined', can_start: left > 0, attempts_left: left, reason: i.idv_failure_reason || null };
  }
  if (i.didit_session_id && i.didit_session_url) return { state: 'open', session_url: i.didit_session_url, can_start: false, attempts_left: left };
  return { state: 'none', can_start: left > 0, attempts_left: left };
}

const fold = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/** The typed name equals the ID name, ignoring case, accents, punctuation and extra spaces. */
export function sameName(typed, idName) {
  return !!fold(typed) && fold(typed) === fold(idName);
}
