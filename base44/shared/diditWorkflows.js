// Didit workflow selection by type and the KYB feature guard.
// Tenant.didit_workflows is a JSON string: [{ id, name, workflow_id, description, type?: 'kyc'|'kyb', is_default?, is_default_kyb? }].
// Entries without a type are KYC (person). KYC defaults use `is_default`; KYB defaults use `is_default_kyb`.

export const wfType = (w) => (w?.type === 'kyb' ? 'kyb' : 'kyc');

export function parseWorkflows(tenant) {
  try {
    const v = typeof tenant?.didit_workflows === 'string' ? JSON.parse(tenant.didit_workflows || '[]') : tenant?.didit_workflows;
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

/** Workflow id for a session: the item's own workflow (when it is of the right type), else the tenant default of that type. */
export function pickWorkflow(tenant, type, itemWorkflowId) {
  const list = parseWorkflows(tenant).filter((w) => wfType(w) === type && w.workflow_id);
  if (itemWorkflowId && list.some((w) => w.workflow_id === itemWorkflowId)) return itemWorkflowId;
  const defKey = type === 'kyb' ? 'is_default_kyb' : 'is_default';
  const def = list.find((w) => w[defKey]) || list[0];
  if (def) return def.workflow_id;
  return type === 'kyc' ? (tenant?.didit_workflow_id || null) : null;
}

/** didit_kyb is default OFF (same semantics as src/lib/featureFlags.js defaultOff). */
export function isKybEnabled(tenant) {
  try {
    if (!tenant?.features_enabled) return false;
    const flags = typeof tenant.features_enabled === 'string' ? JSON.parse(tenant.features_enabled) : tenant.features_enabled;
    return flags.didit_kyb === true;
  } catch {
    return false;
  }
}
