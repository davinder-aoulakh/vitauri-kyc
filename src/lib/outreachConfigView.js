// Guided conversation outreach, Tenant Config view helpers (frontend only; the server rules live in base44/shared/outreachConfig.js).

/** Latest row per key: the newest draft (if newer than the published one) and the newest published row. */
export function versionsByKey(rows = []) {
  const out = {};
  for (const r of rows) {
    const o = (out[r.key] = out[r.key] || { key: r.key, published: null, draft: null });
    if (r.status === 'published' && (!o.published || (r.version || 1) > (o.published.version || 1))) o.published = r;
    if (r.status === 'draft' && (!o.draft || (r.version || 1) > (o.draft.version || 1))) o.draft = r;
  }
  for (const o of Object.values(out)) if (o.draft && o.published && (o.draft.version || 1) <= (o.published.version || 1)) o.draft = null;
  return out;
}

/** The row to show and edit: the draft when there is one, else the published row. */
export const currentOf = (v) => v?.draft || v?.published || null;

export const WIDGET_OPTIONS = ['chips', 'multi', 'text', 'area', 'phone', 'address', 'upload', 'idv', 'confirm_facts', 'registry_search', 'form',
  'people_list', 'reps_list', 'owners_builder', 'structure_card', 'tracker', 'review', 'sign'];
export const SOURCE_LABEL = {
  idv: 'Didit ID check', client: 'Declared by client', ai: 'Declared by client, AI follow-up', doc: 'From document', pre: 'Prefilled from invitation',
  kvk: 'KvK trade register', prop: 'Suggested from registry data, confirmed by client', calc: 'Calculated by the tool', rep: 'Declared by the representative',
};
export const FOLLOW_UP_ACTIONS = ['ask_text', 'ask_area', 'ask_choice', 'ask_file', 'ask_file_per_person', 'ask_people', 'explain_and_reask', 're_request', 'ai_followup', 'rule'];

/** JSON text for an editor box, and back. Returns { value } or { error }. */
export const toJsonText = (v) => (v === undefined || v === null ? '' : JSON.stringify(v, null, 2));
export function fromJsonText(text, { allowEmpty = true, kind = 'object' } = {}) {
  const t = String(text || '').trim();
  if (!t) return allowEmpty ? { value: kind === 'array' ? [] : null } : { error: 'Required' };
  try {
    const v = JSON.parse(t);
    if (kind === 'array' && !Array.isArray(v)) return { error: 'Must be a list [ ... ]' };
    if (kind === 'object' && (typeof v !== 'object' || Array.isArray(v))) return { error: 'Must be an object { ... }' };
    return { value: v };
  } catch (e) {
    return { error: `Not valid JSON: ${e.message}` };
  }
}
