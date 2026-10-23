// Outreach request items and Didit workflow helpers shared by every place that builds a request
// (case outreach step, standalone outreach, form templates). Mirrors base44/shared/diditWorkflows.js.

export const VERIFICATION_TYPES = ['id_verification', 'kyb_verification'];
export const isVerificationItem = (item) => VERIFICATION_TYPES.includes(item?.field_type);

/** 'kyc' (person) or 'kyb' (business). Entries without a type are KYC. */
export const wfType = (w) => (w?.type === 'kyb' ? 'kyb' : 'kyc');

/** Tenant.didit_workflows as an array; tolerates a JSON string, an array or nothing. */
export function parseWorkflows(tenant) {
  try {
    const v = typeof tenant?.didit_workflows === 'string' ? JSON.parse(tenant.didit_workflows || '[]') : tenant?.didit_workflows;
    return Array.isArray(v) ? v.filter((w) => w?.workflow_id) : [];
  } catch {
    return [];
  }
}

/** Workflows of one type. When no KYC list exists, the legacy single didit_workflow_id is offered as one entry. */
export function workflowsOfType(tenant, type) {
  const list = parseWorkflows(tenant).filter((w) => wfType(w) === type);
  if (!list.length && type === 'kyc' && tenant?.didit_workflow_id) {
    return [{ id: 'legacy', name: 'Default workflow', workflow_id: tenant.didit_workflow_id, is_default: true }];
  }
  return list;
}

/** The tenant default workflow of a type (the same choice the server makes), or null. */
export function defaultWorkflow(tenant, type) {
  const list = workflowsOfType(tenant, type);
  const key = type === 'kyb' ? 'is_default_kyb' : 'is_default';
  return list.find((w) => w[key]) || list[0] || null;
}

/** The workflow a verification item will run: its own (when valid for the tenant) or the tenant default. */
export function effectiveWorkflow(tenant, item) {
  const type = item?.field_type === 'kyb_verification' ? 'kyb' : 'kyc';
  const own = item?.idv_workflow_id && workflowsOfType(tenant, type).find((w) => w.workflow_id === item.idv_workflow_id);
  if (own) return { workflow: own, source: 'item' };
  const def = defaultWorkflow(tenant, type);
  return { workflow: def, source: def ? 'default' : 'none' };
}

/**
 * A request item built from a library item (OutreachTemplate). Copies every setting the portal needs,
 * including the Didit workflow. `overrides` (e.g. a workflow chosen for this request) win.
 */
export function buildRequestItem(item, idx, { defaultFieldType = 'file_upload', overrides = {} } = {}) {
  const fieldType = item?.field_type || defaultFieldType;
  return {
    item_id: item?.id,
    label: item?.label || item?.id,
    description: item?.description || '',
    status: 'Requested',
    sort_order: idx,
    field_type: fieldType,
    item_type: item?.item_type || (fieldType === 'file_upload' ? 'document' : 'data_point'),
    field_options: item?.field_options || [],
    validation_required: item?.validation_required ?? false,
    validation_accepted_file_types: item?.validation_accepted_file_types || [],
    validation_max_file_size_mb: item?.validation_max_file_size_mb || 25,
    validation_min_length: item?.validation_min_length || null,
    validation_max_length: item?.validation_max_length || null,
    idv_accepted_doc_types: item?.idv_accepted_doc_types || ['Passport', 'Driving_Licence', 'National_ID'],
    idv_min_match_score: item?.idv_min_match_score ?? 75,
    idv_liveness_required: item?.idv_liveness_required ?? true,
    idv_auto_proceed: item?.idv_auto_proceed ?? false,
    idv_workflow_id: item?.idv_workflow_id || '',
    idv_workflow_name: item?.idv_workflow_name || '',
    section_title: item?.section_title || '',
    ...overrides,
  };
}
