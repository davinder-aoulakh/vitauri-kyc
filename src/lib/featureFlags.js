/**
 * Feature flags — controls which nav items and features are available per tenant.
 * All features default to ENABLED. A Vitauri Ops admin can explicitly disable them.
 * Missing key in tenant.features_enabled === feature is ON.
 */

export const FEATURE_DEFINITIONS = [
  {
    group: 'Outreach',
    features: [
      { key: 'outreach', label: 'Outreach Module', description: 'New Outreach creation and Outreach Dashboard' },
    ],
  },
  {
    group: 'Monitoring',
    features: [
      { key: 'monitoring', label: 'Screening & Monitoring', description: 'AML screening alerts and monitoring dashboard' },
      { key: 'batch_screening', label: 'Batch Screening', description: 'Bulk screening of multiple clients at once' },
      { key: 'review_planner', label: 'Review Planner', description: 'Periodic review scheduling and calendar' },
    ],
  },
  {
    group: 'Clients',
    features: [
      { key: 'batch_upload', label: 'Batch Upload', description: 'CSV batch upload for multiple clients' },
      { key: 'entity_map', label: 'Entity Map & Org Chart', description: 'Visual entity relationship mapping' },
    ],
  },
  {
    group: 'Reports & Admin',
    features: [
      { key: 'mi_dashboard', label: 'MI Dashboard', description: 'Management information and analytics dashboard' },
      { key: 'audit_logs', label: 'Audit Logs', description: 'Full audit trail access' },
      { key: 'archive', label: 'Archive', description: 'Archived / deleted clients view' },
      { key: 'ai_prompts', label: 'AI Prompt Library', description: 'Custom AI prompt configuration' },
    ],
  },
];

/**
 * Check if a feature is enabled for a tenant.
 * Defaults to TRUE if not explicitly set.
 */
export function isFeatureEnabled(tenant, featureKey) {
  if (!tenant?.features_enabled) return true;
  try {
    const flags = typeof tenant.features_enabled === 'string'
      ? JSON.parse(tenant.features_enabled)
      : tenant.features_enabled;
    if (featureKey in flags) return flags[featureKey] !== false;
    return true;
  } catch {
    return true;
  }
}