// profileSuggestionsStore — read-fresh / merge / write for KycCase.profile_suggestions.
// Several places change the same object (Profile Verification grid, the Didit KYB and ID&V suggestion cards, the
// server pipeline). Writing a whole copy that was loaded earlier silently drops the others' changes, so every change
// goes through patchSuggestions: re-read the latest value, change only the touched parts, write.
import { base44 } from '@/api/base44Client';

const asList = (r) => (Array.isArray(r) ? r : r?.items || []);

/** The case's current profile_suggestions straight from the database (null when none). */
export async function loadSuggestions(caseId) {
  if (!caseId) return null;
  const c = asList(await base44.entities.KycCase.filter({ id: caseId }))[0];
  return c?.profile_suggestions || null;
}

/**
 * Apply a field-level change to the latest profile_suggestions and save it.
 * change: { fields?: { [key]: partial | null }, relatedParties?: { [index]: partial }, merge?: (latest) => latest }
 * Returns the saved object.
 */
export async function patchSuggestions(caseId, change = {}) {
  const latest = (await loadSuggestions(caseId)) || { client_fields: {}, related_parties: [] };
  let next = { ...latest, client_fields: { ...(latest.client_fields || {}) }, related_parties: [...(latest.related_parties || [])] };
  for (const [key, val] of Object.entries(change.fields || {})) {
    if (val === null) delete next.client_fields[key];
    else next.client_fields[key] = { ...(next.client_fields[key] || {}), ...val };
  }
  for (const [idx, val] of Object.entries(change.relatedParties || {})) {
    const i = Number(idx);
    if (next.related_parties[i]) next.related_parties[i] = { ...next.related_parties[i], ...val };
  }
  if (typeof change.merge === 'function') next = change.merge(next) || next;
  await base44.entities.KycCase.update(caseId, { profile_suggestions: next });
  return next;
}
