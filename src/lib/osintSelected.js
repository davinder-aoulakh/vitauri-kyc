// OSINT findings the analyst added to the client / entity profile. Stored with the OSINT results on the case
// (KycCase.osint_cache JSON, key `selected`), so they survive a reload and a new search and can be given to the AI draft.
import { base44 } from '@/api/base44Client';

export const findingKey = (f) => String(f?.source_url || f?.title || '').trim().toLowerCase();

/** The line "Add" pastes into the purpose text. */
export const pastedLine = (f) => `[OSINT — ${f?.source_type?.toUpperCase()}] ${f?.title}: ${f?.summary}`;

export function addSelected(list, finding, user) {
  const key = findingKey(finding);
  if (!key || (list || []).some((s) => s.key === key)) return list || [];
  return [...(list || []), {
    key, title: finding.title || '', summary: finding.summary || '', source_type: finding.source_type || '',
    source_url: finding.source_url || '', subject_match: finding.subject_match || '', credibility: finding.credibility || '',
    is_adverse: !!finding.is_adverse, added_by: user?.full_name || '', added_at: new Date().toISOString(),
  }];
}

export const removeSelected = (list, key) => (list || []).filter((s) => s.key !== key);

/** Removes the pasted line of a finding from the text, when it is still there word for word. */
export function stripPastedLine(text, finding) {
  const line = pastedLine(finding);
  if (!text || !text.includes(line)) return text || '';
  return text.replace(line, '').replace(/\n{3,}/g, '\n\n').trim();
}

/** Text block for the AI draft: one line per finding, with what kind of source it is and how sure the match is. */
export function selectedForPrompt(list) {
  return (list || []).map((s, i) => {
    const tags = [s.source_type, s.subject_match && `match: ${s.subject_match}`, s.credibility && `credibility: ${s.credibility}`, s.is_adverse && 'ADVERSE'].filter(Boolean).join(', ');
    return `${i + 1}. ${s.title}${tags ? ` (${tags})` : ''}: ${s.summary}${s.source_url ? ` [source: ${s.source_url}]` : ''}`;
  }).join('\n');
}

const parse = (raw) => { try { return JSON.parse(raw || '{}') || {}; } catch { return {}; } };
export const selectedFromCache = (raw) => (Array.isArray(parse(raw).selected) ? parse(raw).selected : []);

// ── Store: read fresh, change, write; both the OSINT panel and the profile step listen ──
const listeners = new Set();
export function onSelectedChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }
const emit = (caseId, list) => listeners.forEach((fn) => { try { fn(caseId, list); } catch { /* listener errors never block a save */ } });

export async function loadSelected(caseId) {
  const fresh = (await base44.entities.KycCase.filter({ id: caseId }))?.[0];
  return selectedFromCache(fresh?.osint_cache);
}

let chain = Promise.resolve();
/** Applies mutate(list) → list on the latest stored selection (one write at a time). Returns the new list. */
export function patchSelected(caseId, mutate) {
  const run = async () => {
    const fresh = (await base44.entities.KycCase.filter({ id: caseId }))?.[0];
    const cache = parse(fresh?.osint_cache);
    const next = mutate(Array.isArray(cache.selected) ? cache.selected : []);
    await base44.entities.KycCase.update(caseId, { osint_cache: JSON.stringify({ ...cache, selected: next }) });
    emit(caseId, next);
    return next;
  };
  chain = chain.then(run, run);
  return chain;
}
