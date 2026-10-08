/**
 * Feature flags — controls which nav items and features are available per tenant.
 * All features default to ENABLED. A Vitauri Ops admin can explicitly disable them.
 * Missing key in tenant.features_enabled === feature is ON.
 */

export const FEATURE_DEFINITIONS = [
  {
    group: 'Overview',
    features: [
      { key: 'dashboard', label: 'Dashboard', description: 'Main KYC dashboard with overview metrics' },
      { key: 'my_cases', label: 'My Cases', description: 'Analyst personal case queue' },
      { key: 'all_cases', label: 'All Cases', description: 'All cases view (requires viewAllTenantCases permission)' },
    ],
  },
  {
    group: 'Clients',
    features: [
      { key: 'new_client', label: 'New Client', description: 'Client creation form' },
      { key: 'client_search', label: 'Client Search', description: 'Client search and deduplication check' },
      { key: 'batch_upload', label: 'Batch Upload', description: 'CSV batch upload for multiple clients' },
      { key: 'entity_map', label: 'Entity Map & Org Chart', description: 'Visual entity relationship mapping' },
    ],
  },
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
      { key: 'transaction_monitoring', label: 'Transaction Monitoring', description: 'Fiat and crypto transaction screening (AML/KYT)' },
      { key: 'batch_screening', label: 'Batch Screening', description: 'Bulk screening of multiple clients at once' },
      { key: 'review_planner', label: 'Review Planner', description: 'Periodic review scheduling and calendar' },
    ],
  },
  {
    group: 'Reports & Admin',
    features: [
      { key: 'mi_dashboard', label: 'MI Dashboard', description: 'Management information and analytics dashboard' },
      { key: 'audit_logs', label: 'Audit Logs', description: 'Full audit trail access' },
      { key: 'archive', label: 'Archive', description: 'Archived / deleted clients view' },
      { key: 'ai_prompts', label: 'AI Prompt Library', description: 'Custom AI prompt configuration' },
      { key: 'tenant_config', label: 'Tenant Config', description: 'Tenant settings and configuration' },
      { key: 'user_management', label: 'User Management', description: 'User invitation and role management' },
    ],
  },
  {
    group: 'Transaction Monitoring (new)',
    features: [
      { key: 'tm_core', label: 'TM core', description: 'Canonical transactions, alerts, cases, coverage, Customer 360 monitoring tab', defaultOff: true },
      { key: 'tm_ingest_api', label: 'TM ingest API', description: 'Tenant API keys and the ingestTransactions endpoint', defaultOff: true },
      { key: 'tm_kyc_analysis', label: 'KYC transaction analysis', description: 'Statement analysis panel in the SoF/SoW step', defaultOff: true },
      { key: 'tm_rules', label: 'TM rule builder', description: 'Rules authored in Vitauri and synced to Didit', defaultOff: true },
      { key: 'tm_fiu', label: 'FIU reporting', description: 'One-click FIU reports for FIU Curaçao and FIU-Netherlands', defaultOff: true },
      { key: 'tm_quality', label: 'TM quality control', description: 'Coverage matrix, below-the-line samples, AI shadow metrics', defaultOff: true },
    ],
  },
];

export function getFeatureDefinition(key) {
  for (const g of FEATURE_DEFINITIONS) {
    const f = g.features.find(x => x.key === key);
    if (f) return f;
  }
  return undefined;
}

/**
 * Check if a feature is enabled for a tenant.
 * Missing key: ON, unless the feature definition has defaultOff: true.
 */
export function isFeatureEnabled(tenant, featureKey) {
  try {
    const defaultValue = !getFeatureDefinition(featureKey)?.defaultOff;
    if (!tenant?.features_enabled) return defaultValue;
    const flags = typeof tenant.features_enabled === 'string'
      ? JSON.parse(tenant.features_enabled)
      : tenant.features_enabled;
    if (featureKey in flags) return defaultValue ? flags[featureKey] !== false : flags[featureKey] === true;
    return defaultValue;
  } catch {
    return !getFeatureDefinition(featureKey)?.defaultOff;
  }
}