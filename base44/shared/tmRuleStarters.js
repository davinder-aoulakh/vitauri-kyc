// Four conservative starter rules derived from library scenarios. Always created as inactive drafts. Thresholds are illustrative.
import { asList } from './tmAuth.js';
import { writeAudit } from './tmAudit.js';
import { validateDefinition } from './tmRuleSchema.js';

export const STARTER_CODES = ['S-07a', 'S-11', 'S-12', 'S-CW-OBJ-CASH'];
const HIGH_RISK_COUNTRIES = ['IR', 'KP', 'MM']; // illustrative: FATF call-for-action list; maintain per tenant

/** Threshold in reporting currency: tenant tm_settings, else an illustrative default. */
export function tenantThreshold(tenant) {
  const s = typeof tenant?.tm_settings === 'string' ? safeJson(tenant.tm_settings) : tenant?.tm_settings || {};
  const raw = s.objective_threshold ?? s.reporting_threshold ?? s.thresholds?.objective ?? s.thresholds?.reporting;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : 10000;
}
function safeJson(t) { try { return JSON.parse(t); } catch { return {}; } }

const each = { subject_vendor_data: '__current__' };
const round = (n) => Math.round(n / 100) * 100;

const BUILDERS = {
  'S-07a': (thr) => ({
    title: 'Smurfing via private senders', category: 'aml_ctf', evaluation_mode: 'ALL',
    description: `Many different senders paying in amounts just under ${thr} within a week. Thresholds are illustrative.`,
    scope: { transaction_types: ['finance'], directions: ['INBOUND'] },
    conditions: [{ field: 'direction', operator: 'eq', value: 'INBOUND' }, { field: 'amount', operator: 'gte', value: round(thr * 0.5) }, { field: 'amount', operator: 'lt', value: thr }],
    aggregation: [
      { metric: 'distinct_count', field: 'counterparty_vendor_data', operator: 'gte', value: 5, window: '7d', filters: { ...each, direction: 'INBOUND' } },
      { metric: 'sum', field: 'amount', operator: 'gte', value: thr, window: '7d', filters: { ...each, direction: 'INBOUND' } },
    ],
    actions: [{ type: 'add_score', value: 30 }, { type: 'add_tags', tag_name: 'SMURFING' }],
  }),
  'S-11': (thr) => ({
    title: 'Rapid in and out', category: 'aml_ctf', evaluation_mode: 'ALL',
    description: 'Large outgoing payment shortly after large incoming payments (pass-through). Thresholds are illustrative.',
    scope: { transaction_types: ['finance'], directions: ['OUTBOUND'] },
    conditions: [{ field: 'direction', operator: 'eq', value: 'OUTBOUND' }, { field: 'amount', operator: 'gte', value: round(thr * 0.5) }],
    aggregation: [{ metric: 'sum', field: 'amount', operator: 'gte', value: round(thr * 0.8), window: '24h', filters: { ...each, direction: 'INBOUND' } }],
    actions: [{ type: 'add_score', value: 35 }, { type: 'add_tags', tag_name: 'PASS_THROUGH' }],
  }),
  'S-12': () => ({
    title: 'New high-risk country', category: 'fatf', evaluation_mode: 'ALL',
    description: 'First payments to or from a high-risk country. Country list is illustrative; maintain it for your institution.',
    scope: { transaction_types: ['finance'], directions: ['INBOUND', 'OUTBOUND'] },
    conditions: [{ field: 'counterparty_country', operator: 'in', value: HIGH_RISK_COUNTRIES }],
    aggregation: [{ metric: 'count', operator: 'lte', value: 1, window: '90d', filters: { ...each, counterparty_country: '__current__' } }],
    actions: [{ type: 'add_score', value: 40 }, { type: 'add_tags', tag_name: 'HIGH_RISK_COUNTRY' }],
  }),
  'S-CW-OBJ-CASH': (thr) => ({
    title: 'Cash above objective threshold', category: 'finance', evaluation_mode: 'ALL',
    description: `Cash transaction at or above ${thr} (objective indicator). Needs custom_properties.payment_channel = "cash" on submitted transactions. Threshold is illustrative.`,
    scope: { transaction_types: ['finance'], directions: ['INBOUND', 'OUTBOUND'] },
    conditions: [{ field: 'custom_values.payment_channel', operator: 'eq', value: 'cash' }, { field: 'amount', operator: 'gte', value: thr }],
    aggregation: [],
    actions: [{ type: 'add_score', value: 50 }, { type: 'add_tags', tag_name: 'CASH_OBJECTIVE' }],
  }),
};

/** Idempotent: one draft per scenario code (seed_key). Returns { created:[codes], existing:[codes], missing_scenarios:[codes] }. */
export async function seedStarterRules(ctx) {
  const { E, tenantId, tenant, auth } = ctx;
  const [scenarios, existing] = await Promise.all([
    E.TmScenario.filter({ tenant_id: tenantId, code: { $in: STARTER_CODES } }, undefined, 50).then(asList),
    E.TmRule.filter({ tenant_id: tenantId, seed_key: { $regex: '^starter:' } }, undefined, 50).then(asList),
  ]);
  const have = new Set(existing.map((r) => r.seed_key));
  const thr = tenantThreshold(tenant);
  const out = { created: [], existing: [], missing_scenarios: [] };
  for (const code of STARTER_CODES) {
    const sc = scenarios.find((s) => s.code === code);
    if (have.has(`starter:${code}`)) { out.existing.push(code); continue; }
    if (!sc) { out.missing_scenarios.push(code); continue; }
    const def = validateDefinition(BUILDERS[code](thr));
    await E.TmRule.create({
      tenant_id: tenantId, name: def.title, scenario_id: sc.id, version: 1, definition: def,
      nl_source: `Starter rule derived from library scenario ${code} (${sc.name}).`, mode: 'draft', sync_status: 'not_synced',
      approval_status: 'not_requested', created_by_user_id: auth.actorUserId, owner_user_id: auth.actorUserId,
      lineage_id: crypto.randomUUID(), seed_key: `starter:${code}`,
      change_note: `Starter draft from scenario ${code}. Thresholds are illustrative (base ${thr}); review before use.`,
    });
    out.created.push(code);
  }
  if (out.created.length) {
    await writeAudit(ctx.base44, auth, { tenantId, eventType: 'tm_rules_seeded', before: { existing: out.existing }, after: { created: out.created }, notes: `Created ${out.created.length} inactive starter rule draft(s): ${out.created.join(', ')}.` });
  }
  return out;
}