// Outreach & Documents: how the status of an outreach item and of its Document relate.
// Pure rules, used by OutreachStep. The AI rating is advisory; a flagged document is always decided by a person.

/** Rule version of the AI Document Checker (base44/shared/docCheckAgent.js CHECK_VERSION; kept equal by a test). */
export const DOC_CHECK_VERSION = '2';

const FLAGS = ['high_risk', 'needs_attention'];

export const docPending = (doc) => !!doc && !doc.is_deleted && (doc.review_status || 'Pending_Review') === 'Pending_Review';

/** Flagged by the checker and not reviewed yet. */
export const docFlagged = (doc) => docPending(doc) && FLAGS.includes(doc.ai_check?.verdict);

/** May the document be approved or rejected in the case? Not tied to the item still being "Received". */
export function docDecidable(doc, item, locked) {
  if (locked || !docPending(doc) || !item) return false;
  return item.status === 'Received' || item.status === 'Verified';
}

/** Same rule as the checker's own: the client's uploads only. */
function checkable(doc) {
  if (!doc || doc.is_deleted || !doc.file_url) return false;
  if (['didit', 'didit_kyb'].includes(doc.source)) return false;
  if (doc.is_ai_generated || doc.doc_type === 'KYC_Report') return false;
  return !String(doc.file_name || '').startsWith('Didit_Verification_Report_');
}

/** A stored rating that is out of date (older rule version) or a check that failed, on a document no person reviewed yet. */
export function needsRecheck(doc, currentVersion = DOC_CHECK_VERSION) {
  if (!checkable(doc) || !docPending(doc) || doc.reviewed_by_user_id) return false;
  const c = doc.ai_check;
  if (!c) return false;
  if (c.status === 'error') return true;
  return String(c.version || '1') !== String(currentVersion);
}

/**
 * Documents that may be approved without a new decision: their outreach item was already verified by a person,
 * the document is still pending and the checker raised no flag. A flagged document is never in this list.
 * A document whose rating is out of date waits for the re-check, unless that was tried in this session (`attempted`).
 */
export function catchUpApprovals(items, docs, { locked = false, currentVersion = DOC_CHECK_VERSION, attempted = [] } = {}) {
  if (locked) return [];
  const tried = new Set(attempted);
  const out = [];
  const seen = new Set();
  for (const item of items || []) {
    if (item?.status !== 'Verified' || !item.file_url) continue;
    const doc = (docs || []).find((d) => d.file_url === item.file_url);
    if (!docPending(doc) || docFlagged(doc) || seen.has(doc.id)) continue;
    if (needsRecheck(doc, currentVersion) && !tried.has(doc.id)) continue;
    seen.add(doc.id);
    out.push(doc);
  }
  return out;
}
