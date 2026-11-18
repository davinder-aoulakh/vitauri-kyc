// Guided conversation outreach: who may do what, server side. Mirrors the permission keys in src/lib/permissions.js.
export const OUTREACH_CONFIG_ROLES = ['Tenant Admin', 'Compliance Admin'];                       // outreachConfig
export const OUTREACH_WORK_ROLES = ['Analyst', 'QC Reviewer', 'Compliance Officer', 'Manager', 'Director', 'Compliance Admin', 'Tenant Admin']; // outreachConversationWork (same as sendOutreachEmail)
export const OUTREACH_SEED_ROLES = ['Tenant Admin', 'Vitauri Ops'];
export const OPS_ROLE = 'Vitauri Ops';
