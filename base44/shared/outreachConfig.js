// Guided conversation outreach: rules for editing blocks and templates in Tenant Config (manageOutreachConfig).
// Pure: no I/O. Versioning: one row per key and version. Editing a published row creates a draft with version + 1;
// publishing turns the draft into the current published version. Requests only ever use published rows.
import { validateCondition } from './outreachConditions.js';
import { WIDGETS } from './outreachSeed.js';

export const BLOCK_FIELDS = ['label', 'section_key', 'client_types', 'widget', 'question_template', 'variants', 'why_text', 'options', 'multi',
  'none_option', 'datapoints', 'kyc_mapping', 'show_if', 'follow_ups', 'evidence', 'prefill', 'validation', 'edit', 'active_default', 'translations'];
export const TEMPLATE_FIELDS = ['name', 'client_type', 'case_types', 'sections', 'items', 'settings', 'intro_messages', 'start_chip',
  'expected_minutes', 'default_deadline_days', 'channel', 'notes'];
export const DATAPOINT_SOURCES = ['idv', 'client', 'ai', 'doc', 'pre', 'kvk', 'prop', 'calc', 'rep'];
export const FOLLOW_UP_ACTIONS = ['ask_text', 'ask_area', 'ask_choice', 'ask_file', 'ask_file_per_person', 'ask_people', 'explain_and_reask', 're_request', 'ai_followup', 'rule'];
const CLIENT_TYPES = ['NP', 'ORG', 'RP'];

const str = (v, n = 4000) => (v === undefined || v === null ? null : String(v).slice(0, n));
const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const strList = (v, n = 200) => (Array.isArray(v) ? v.map((x) => String(x ?? '').trim()).filter(Boolean).slice(0, n) : []);

/** Latest row per key: the newest draft if one exists, and the newest published row. */
export function versionsByKey(rows = []) {
  const out = {};
  for (const r of rows) {
    const o = (out[r.key] = out[r.key] || { key: r.key, published: null, draft: null, versions: [] });
    o.versions.push(r.version || 1);
    if (r.status === 'published' && (!o.published || (r.version || 1) > (o.published.version || 1))) o.published = r;
    if (r.status === 'draft' && (!o.draft || (r.version || 1) > (o.draft.version || 1))) o.draft = r;
  }
  for (const o of Object.values(out)) if (o.draft && o.published && (o.draft.version || 1) <= (o.published.version || 1)) o.draft = null;
  return out;
}

/** The version a new draft gets: one above the highest version of the key. */
export const nextVersion = (rows = [], key) => Math.max(0, ...rows.filter((r) => r.key === key).map((r) => Number(r.version) || 1)) + 1;

/** Validated block fields from an edit. Returns { fields, errors }. knownBlocks: all block keys (for conditions). */
export function cleanBlockInput(input = {}, knownBlocks = null) {
  const errors = [];
  const f = {};
  for (const k of BLOCK_FIELDS) if (input[k] !== undefined) f[k] = input[k];
  if ('label' in f) { f.label = str(f.label, 200); if (!f.label) errors.push('label: required'); }
  if ('section_key' in f) f.section_key = str(f.section_key, 40);
  if ('client_types' in f) { f.client_types = strList(f.client_types).filter((c) => CLIENT_TYPES.includes(c)); if (!f.client_types.length) errors.push('client_types: choose NP, ORG or RP'); }
  if ('widget' in f && !WIDGETS.includes(f.widget)) errors.push(`widget: unknown widget "${f.widget}"`);
  for (const k of ['question_template', 'why_text', 'none_option', 'kyc_mapping', 'prefill']) if (k in f) f[k] = str(f[k]);
  if ('options' in f) f.options = strList(f.options);
  if ('multi' in f) f.multi = f.multi === true;
  if ('active_default' in f) f.active_default = f.active_default !== false;
  for (const k of ['variants', 'evidence', 'validation', 'edit', 'translations']) if (k in f && f[k] !== null && !isObj(f[k])) errors.push(`${k}: must be an object`);
  if ('datapoints' in f) {
    if (!Array.isArray(f.datapoints)) errors.push('datapoints: must be a list');
    else f.datapoints.forEach((d, i) => {
      if (!d?.key) errors.push(`datapoints[${i}]: key required`);
      const bad = (d?.sources || []).filter((s) => !DATAPOINT_SOURCES.includes(s));
      if (bad.length) errors.push(`datapoints[${i}]: unknown source ${bad.join(', ')}`);
    });
  }
  if ('show_if' in f) {
    if (f.show_if && !isObj(f.show_if)) errors.push('show_if: must be a condition');
    else errors.push(...validateCondition(f.show_if, knownBlocks, 'show_if'));
  }
  if ('follow_ups' in f) {
    if (!Array.isArray(f.follow_ups)) errors.push('follow_ups: must be a list');
    else f.follow_ups.forEach((x, i) => {
      if (!FOLLOW_UP_ACTIONS.includes(x?.action)) errors.push(`follow_ups[${i}]: unknown action "${x?.action}"`);
      errors.push(...validateCondition(x?.when, knownBlocks, `follow_ups[${i}].when`));
    });
  }
  return { fields: f, errors };
}

/** Validated template fields from an edit. knownBlocks: block keys that exist for the tenant. */
export function cleanTemplateInput(input = {}, knownBlocks = null) {
  const errors = [];
  const f = {};
  for (const k of TEMPLATE_FIELDS) if (input[k] !== undefined) f[k] = input[k];
  if ('name' in f) { f.name = str(f.name, 200); if (!f.name) errors.push('name: required'); }
  if ('client_type' in f && !CLIENT_TYPES.includes(f.client_type)) errors.push('client_type: NP, ORG or RP');
  if ('case_types' in f) f.case_types = strList(f.case_types);
  if ('intro_messages' in f) f.intro_messages = strList(f.intro_messages, 20).map((x) => x.slice(0, 2000));
  if ('start_chip' in f) f.start_chip = str(f.start_chip, 80);
  for (const k of ['expected_minutes', 'default_deadline_days']) if (k in f) {
    const n = Number(f[k]);
    if (f[k] === null || f[k] === '') f[k] = null; else if (!Number.isFinite(n) || n < 1 || n > 365) errors.push(`${k}: a number from 1 to 365`); else f[k] = n;
  }
  if ('settings' in f && f.settings !== null && !isObj(f.settings)) errors.push('settings: must be an object');
  if ('sections' in f) {
    if (!Array.isArray(f.sections)) errors.push('sections: must be a list');
    else f.sections = f.sections.filter((s) => s?.key).map((s) => ({ key: String(s.key).slice(0, 40), label: String(s.label || s.key).slice(0, 120) }));
  }
  if ('items' in f) {
    if (!Array.isArray(f.items)) errors.push('items: must be a list');
    else {
      const seen = new Set();
      f.items = f.items.map((it, i) => {
        if (!it?.block_key) { errors.push(`items[${i}]: block required`); return it; }
        if (knownBlocks && !knownBlocks.includes(it.block_key)) errors.push(`items[${i}]: unknown block "${it.block_key}"`);
        if (seen.has(it.block_key)) errors.push(`items[${i}]: block "${it.block_key}" is listed twice`);
        seen.add(it.block_key);
        return { block_key: it.block_key, block_version: Number(it.block_version) || null, active: it.active !== false, ...(it.section_key ? { section_key: String(it.section_key).slice(0, 40) } : {}) };
      });
    }
  }
  return { fields: f, errors };
}

/** Fields of a row copied into a new draft (no id, status or dates). */
export function draftFrom(row, fields, version) {
  const out = {};
  for (const k of fields) if (row[k] !== undefined) out[k] = row[k];
  return { ...out, key: row.key, raw: row.raw ?? null, version, status: 'draft' };
}

/** Pins every template item to the block's current published version (at publish time). */
export function pinItems(items = [], publishedBlocks = {}) {
  return items.map((it) => ({ ...it, block_version: publishedBlocks[it.block_key]?.version || it.block_version || 1 }));
}

/** Integration input from Vitauri Ops. Live needs a key. Returns { patch, errors }. */
export function cleanIntegration({ kvk_mode, kvk_api_key } = {}, { hasKey = false } = {}) {
  const errors = [];
  const patch = {};
  if (kvk_api_key !== undefined) {
    const k = String(kvk_api_key || '').trim();
    if (k && (k.length < 8 || k.length > 200 || /\s/.test(k))) errors.push('kvk_api_key: does not look like a KvK API key');
    else patch.kvk_api_key = k; // '' removes the key
  }
  if (kvk_mode !== undefined) {
    if (!['off', 'test', 'live'].includes(kvk_mode)) errors.push('kvk_mode: off, test or live');
    else patch.kvk_mode = kvk_mode;
  }
  const keyAfter = patch.kvk_api_key !== undefined ? !!patch.kvk_api_key : hasKey;
  if (patch.kvk_mode === 'live' && !keyAfter) errors.push('kvk_mode: Live needs a KvK API key first');
  if (patch.kvk_api_key === '' && patch.kvk_mode === undefined) patch.kvk_mode_if_live = 'off'; // removing the key ends Live
  return { patch, errors };
}
