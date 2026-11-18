// Guided conversation outreach: maps the pack (02-block-library.json, 03-form-templates.json) to OutreachBlock and
// OutreachFlowTemplate rows. Pure: no I/O. The original pack entry is kept unchanged in `raw`.
// Normalisations (plan section 5, "Seed mapping"):
//  - widget names of the pack -> the catalogue of spec 5.2 (the original stays in raw.widget)
//  - show_if "after idv" is not a condition: treated as always true (the order guarantees it)
//  - datapoint default_source "kvk|doc" -> sources ['kvk', 'doc']
//  - templates: `blocks` (ids) -> items[], `sections` (pairs) -> sections[]
//  - the related-party template reuses NP blocks: those get client type RP; `pep` sits in section `contact` there
//  - the ORG block `rep` contains the NP blocks idv, name_confirm and pep as steps
//  - the bank name in texts -> {tenant_name}
//  - pep follow-ups pep_detail_who and pep_detail_rel combine into pep_detail
//  - profile_field on a datapoint only where a KYC field clearly matches; the rest is reported, not guessed

export const PACK_BANK_NAME = 'New Age Bank';

export const WIDGET_MAP = {
  confirm_or_text: 'confirm_facts',
  registry_lookup_or_document: 'registry_search',
  ownership_builder: 'owners_builder',
  calculated_confirm: 'confirm_facts',
  'chips + people_with_authority + upload': 'chips',
  'chips + related_party_tracker': 'tracker',
  'idv + chips': 'idv',
};
export const WIDGETS = ['chips', 'multi', 'text', 'area', 'phone', 'address', 'upload', 'idv', 'confirm_facts', 'registry_search', 'form',
  'people_list', 'reps_list', 'owners_builder', 'structure_card', 'tracker', 'review', 'sign'];

// Datapoint key -> PROFILE_FIELDS key (src/lib/profileFieldMap.js), only where the meaning is the same.
export const PROFILE_FIELD_MAP = {
  NP: { full_name: 'full_name', dob: 'date_of_birth', nat: 'nationality', address: 'residential_address', email: 'primary_contact_email', phone: 'primary_contact_phone' },
  ORG: { legal_name: 'full_name', reg_no: 'registration_number', legal_form: 'legal_form', co_address: 'registered_address', country: 'registered_country', sbi: 'sector', co_activity: 'sector' },
};

const VARIANT_KEYS = ['question_company', 'question_partnership', 'question_nl', 'question_document', 'question_empty', 'question_who', 'route_nl', 'route_document', 'routing', 'steps', 'groups', 'options_from', 'note_queue', 'note_threshold', 'precede_with', 'algorithm', 'ubo_name_rule', 'when_no_registered_activity', 'party_effect', 'on_decline', 'behaviour', 'provider', 'fields', 'declaration'];
const REP_STEPS = ['idv', 'name_confirm', 'pep'];
const PEP_PARTS = ['pep_detail_who', 'pep_detail_rel'];

/** Replaces the pack's bank name by {tenant_name} in every string of a value. */
export function templatiseBankName(v) {
  if (typeof v === 'string') return v.split(PACK_BANK_NAME).join('{tenant_name}');
  if (Array.isArray(v)) return v.map(templatiseBankName);
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, templatiseBankName(x)]));
  return v;
}
export const normaliseWidget = (w) => (WIDGETS.includes(w) ? w : WIDGET_MAP[w] || null);
export const normaliseShowIf = (s) => (!s || typeof s === 'string' ? null : s);
export const sourcesOf = (s) => String(s || '').split('|').map((x) => x.trim()).filter(Boolean);

function evidenceOf(raw) {
  const checks = raw.document_checks || null;
  const byForm = raw.document_checks_company || raw.document_checks_partnership
    ? { company: raw.document_checks_company || [], partnership: raw.document_checks_partnership || [] } : null;
  const required = raw.widget === 'upload' || !!checks || !!byForm;
  if (!required && raw.allow_defer === undefined && typeof raw.evidence !== 'string') return null;
  return {
    required,
    allow_defer: raw.allow_defer === true,
    defer_creates_open_request: raw.allow_defer === true,
    document_checks: checks || [],
    ...(byForm ? { document_checks_by_form: byForm } : {}),
    ...(typeof raw.evidence === 'string' ? { note: raw.evidence } : {}),
  };
}

function followUpOf(f) {
  const out = { ...f };
  if (PEP_PARTS.includes(f.key)) out.combine_into = 'pep_detail';
  return out;
}

/** One pack block -> OutreachBlock fields (without tenant_id). */
export function blockRow(raw, { relatedPartyKeys = [] } = {}) {
  const t = templatiseBankName(raw);
  const clientTypes = [...new Set([...(raw.client_types || []), ...(relatedPartyKeys.includes(raw.id) ? ['RP'] : [])])];
  const ct = clientTypes.includes('ORG') ? 'ORG' : 'NP';
  const variants = Object.fromEntries(VARIANT_KEYS.filter((k) => t[k] !== undefined).map((k) => [k, t[k]]));
  if (raw.id === 'rep') variants.step_blocks = REP_STEPS;
  if (raw.widget !== normaliseWidget(raw.widget)) variants.pack_widget = raw.widget;
  return {
    key: raw.id,
    version: Number(raw.version) || 1,
    status: 'published',
    label: t.label || raw.id,
    section_key: raw.section || null,
    client_types: clientTypes,
    widget: normaliseWidget(raw.widget),
    question_template: t.question || null,
    variants,
    why_text: t.why || null,
    options: t.options || [],
    multi: raw.widget === 'multi',
    none_option: t.none_option || null,
    datapoints: (t.datapoints || []).map((d) => {
      const pf = PROFILE_FIELD_MAP[ct][d.key] || null;
      return { key: d.key, label: d.label, type: d.type, sources: sourcesOf(d.default_source), ...(pf ? { profile_field: pf } : {}) };
    }),
    kyc_mapping: t.kyc_mapping || null,
    show_if: normaliseShowIf(raw.show_if),
    follow_ups: (t.follow_ups || []).map(followUpOf),
    evidence: evidenceOf(t),
    prefill: typeof t.prefill === 'string' ? t.prefill : null,
    validation: raw.validation ? (typeof t.validation === 'string' ? { message: t.validation } : t.validation) : null,
    edit: t.edit || null,
    active_default: raw.active_default !== false,
    translations: {},
    raw,
  };
}

/** One pack template -> OutreachFlowTemplate fields (without tenant_id). */
export function templateRow(raw, blockVersions = {}) {
  const t = templatiseBankName(raw);
  const isRp = raw.id === 'related_party_np';
  const clientType = isRp ? 'RP' : raw.client_type === 'ORG' ? 'ORG' : 'NP';
  const activeDefault = (k) => (blockVersions[k] ? blockVersions[k].active_default !== false : true);
  return {
    key: raw.id,
    name: t.name,
    client_type: clientType,
    case_types: raw.case_types || [],
    version: 1,
    status: 'published',
    sections: (raw.sections || []).map(([key, label]) => ({ key, label })),
    items: (raw.blocks || []).map((k) => ({
      block_key: k,
      block_version: blockVersions[k]?.version || 1,
      active: activeDefault(k),
      ...(isRp && k === 'pep' ? { section_key: 'contact' } : {}),
    })),
    settings: raw.settings || {},
    intro_messages: t.intro || [],
    start_chip: t.start_chip || null,
    expected_minutes: Number(raw.expected_minutes) || null,
    default_deadline_days: Number(raw.default_deadline_days) || null,
    channel: t.channel || null,
    notes: t.notes || null,
    raw,
  };
}

/** The whole seed: { blocks, templates, unmapped } where unmapped lists datapoints without a KYC field link. */
export function buildSeed(library, forms) {
  const rpTemplate = (forms.templates || []).find((x) => x.id === 'related_party_np');
  const relatedPartyKeys = rpTemplate ? rpTemplate.blocks : [];
  const blocks = [...(library.np_blocks || []), ...(library.org_blocks || [])].map((b) => blockRow(b, { relatedPartyKeys }));
  const byKey = Object.fromEntries(blocks.map((b) => [b.key, b]));
  const templates = (forms.templates || []).map((t) => templateRow(t, byKey));
  const unmapped = blocks.flatMap((b) => b.datapoints.filter((d) => !d.profile_field && d.type !== 'file').map((d) => `${b.key}.${d.key}`));
  return { blocks, templates, unmapped };
}

/**
 * What an import does for one tenant, idempotent by key: rows that exist are left alone (a tenant's own edits win).
 * existing: { blocks: [{ key }], templates: [{ key }] }. Returns { createBlocks, createTemplates, skipped }.
 */
export function planImport(seed, existing = {}) {
  const haveB = new Set((existing.blocks || []).map((b) => b.key));
  const haveT = new Set((existing.templates || []).map((t) => t.key));
  return {
    createBlocks: seed.blocks.filter((b) => !haveB.has(b.key)),
    createTemplates: seed.templates.filter((t) => !haveT.has(t.key)),
    skipped: [...seed.blocks.filter((b) => haveB.has(b.key)).map((b) => `block:${b.key}`), ...seed.templates.filter((t) => haveT.has(t.key)).map((t) => `template:${t.key}`)],
  };
}
