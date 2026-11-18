// Guided conversation outreach: what a request is built from. Pure: no I/O.
// When a request is sent, the published template and the published versions of its blocks are copied into the conversation.
// Later edits in Tenant Config (a new draft, or a new published version) never change a request in flight. Drafts are never used.

const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
const BLOCK_FIELDS = ['key', 'version', 'label', 'section_key', 'client_types', 'widget', 'question_template', 'variants', 'why_text', 'options', 'multi',
  'none_option', 'datapoints', 'kyc_mapping', 'show_if', 'follow_ups', 'evidence', 'prefill', 'validation', 'edit', 'translations'];
const TEMPLATE_FIELDS = ['key', 'version', 'name', 'client_type', 'case_types', 'sections', 'items', 'settings', 'intro_messages', 'start_chip',
  'expected_minutes', 'default_deadline_days', 'channel'];

/** Newest published template for a client type and case type (case type matched loosely, e.g. "Onboarding" on "Onboarding (child …)"). */
export function pickTemplate(templates = [], clientType, caseType) {
  const pub = templates.filter((t) => t.status === 'published' && t.client_type === clientType);
  const ct = String(caseType || '').toLowerCase().replace(/_/g, ' ');
  const fits = (t) => !(t.case_types || []).length || (t.case_types || []).some((c) => { const x = String(c).toLowerCase().replace(/_/g, ' '); return ct && (x === ct || x.startsWith(ct) || ct.startsWith(x)); });
  const newest = (list) => list.sort((a, b) => (b.version || 1) - (a.version || 1))[0] || null;
  const byKey = {};
  for (const t of pub.filter(fits)) if (!byKey[t.key] || (t.version || 1) > (byKey[t.key].version || 1)) byKey[t.key] = t;
  return newest(Object.values(byKey));
}

/**
 * Frozen copy for a request. template: published template row; blocks: all block rows of the tenant (any status);
 * settings: outreachSettings(tenant); kvkMode: off | test | live. Throws when an item's published block version is missing.
 */
export function buildSnapshot({ template, blocks = [], settings = {}, kvkMode = 'off' }) {
  if (!template || template.status !== 'published') throw new Error('Only a published template can be sent');
  const t = Object.fromEntries(TEMPLATE_FIELDS.map((k) => [k, clone(template[k])]));
  const out = {};
  const missing = [];
  for (const it of t.items || []) {
    const pub = blocks.filter((b) => b.key === it.block_key && b.status === 'published');
    const pinned = pub.find((b) => (b.version || 1) === (it.block_version || 0)) || null;
    const row = pinned || pub.sort((a, b) => (b.version || 1) - (a.version || 1))[0];
    if (!row) { missing.push(it.block_key); continue; }
    out[it.block_key] = Object.fromEntries(BLOCK_FIELDS.map((k) => [k, clone(row[k])]));
    it.block_version = row.version || 1;
  }
  if (missing.length) throw new Error(`These blocks have no published version: ${missing.join(', ')}`);
  return {
    template_key: t.key, template_version: t.version || 1, template_snapshot: t, blocks_snapshot: out,
    settings_snapshot: clone({ ...settings, ...(t.settings || {}) }), kvk_environment: ['test', 'live'].includes(kvkMode) ? kvkMode : 'off',
  };
}

/** Replaces {placeholders}; unknown ones are left out (never shown as braces to a client). */
export function fillPlaceholders(text, vars = {}) {
  return String(text ?? '').replace(/\{([a-zA-Z_][a-zA-Z0-9_]*)\}/g, (_, k) => (vars[k] === undefined || vars[k] === null ? '' : String(vars[k]))).replace(/\s{2,}/g, ' ').trim();
}

/** First name for the greeting: preferred name, else the first given name, else the first word of the full name. */
export function firstNameOf(client = {}, invitedName = '') {
  const p = String(client.preferred_name || '').trim();
  if (p) return p.split(/\s+/)[0];
  const f = String(client.first_names || '').trim();
  if (f) return f.split(/\s+/)[0];
  return String(invitedName || client.full_name || '').trim().split(/\s+/)[0] || '';
}

/** Initial progress total: the template's active items (the engine refines this from phase 3 on). */
export function initialProgressTotal(snapshot) {
  return (snapshot?.template_snapshot?.items || []).filter((i) => i.active !== false).length;
}

/** Sections for the left rail with their state, from the snapshot and the block states. */
export function sectionsView(snapshot, blockStates = {}, currentBlock = null) {
  const t = snapshot?.template_snapshot || {};
  const items = (t.items || []).filter((i) => i.active !== false);
  const sectionOf = (i) => i.section_key || snapshot?.blocks_snapshot?.[i.block_key]?.section_key || null;
  return (t.sections || []).map((s) => {
    const mine = items.filter((i) => sectionOf(i) === s.key);
    const done = mine.length > 0 && mine.every((i) => ['answered', 'skipped', 'off'].includes(blockStates[i.block_key]?.state));
    const current = !!currentBlock && mine.some((i) => i.block_key === currentBlock);
    return { key: s.key, label: s.label, state: done ? 'done' : current ? 'current' : 'todo' };
  });
}

/** Minutes left per spec 5.5: round((total - steps) x 0.4). */
export const minutesLeft = (total, steps) => Math.max(0, Math.round((Math.max(0, (total || 0) - (steps || 0))) * 0.4));
