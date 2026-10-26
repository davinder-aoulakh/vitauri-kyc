// Didit's preset rule library and Didit rules that Vitauri does not manage. Backend only (uses tenant.didit_api_key via diditTm).
// Library rules are imported as Vitauri drafts and then follow the normal approval -> sync flow. Nothing here writes to Didit.
import { asList, httpError } from './tmAuth.js';
import { writeAudit } from './tmAudit.js';
import { tenantUsers, roleOf } from './tmCaseCommon.js';
import { listLibraryRules, listRules } from './diditTm.js';
import { validateDefinition } from './tmRuleSchema.js';
import { saveRule } from './tmRuleActions.js';

const DEF_KEYS = ['title', 'description', 'category', 'evaluation_mode', 'scope', 'conditions', 'aggregation', 'actions'];
const MANAGED_MARK = 'Managed by Vitauri';
const clip = (s, n = 400) => String(s ?? '').trim().slice(0, n);
const audit = (ctx, type, before, after, notes) => writeAudit(ctx.base44, ctx.auth, { tenantId: ctx.tenantId, eventType: type, before, after, notes });

/** The Didit-native part of a library or registered rule, in the shape Vitauri stores (TmRule.definition). */
export function definitionOf(item) {
  const out = {};
  for (const k of DEF_KEYS) if (item?.[k] !== undefined && item[k] !== null) out[k] = item[k];
  if (!out.title && item?.name) out.title = item.name;
  if (out.scope && typeof out.scope === 'object') out.scope = Object.fromEntries(Object.entries(out.scope).filter(([k]) => ['transaction_types', 'directions'].includes(k)));
  return out;
}

function checkDefinition(item) {
  try { return { definition: validateDefinition(definitionOf(item)), problem: '' }; } catch (e) { return { definition: definitionOf(item), problem: e?.message || 'Not supported by the Vitauri rule editor' }; }
}

/** One library entry for the UI: readable fields only, plus whether Vitauri can import it and the draft it already became. */
function describe(item, imported) {
  const { definition, problem } = checkDefinition(item);
  const rule = imported.get(item.library_key);
  return {
    library_key: item.library_key, title: item.title, description: item.description || '', category: item.category || '',
    bundle: item.bundle || item.metadata?.bundle || '', industries: item.industries || item.metadata?.industries || [], tags: item.tags || [],
    installed_in_didit: !!item.is_installed, importable: !problem, problem, definition,
    imported_rule_id: rule?.id || null, imported_rule_mode: rule?.mode || null,
  };
}

async function importedMap(E, tenantId) {
  const rules = asList(await E.TmRule.filter({ tenant_id: tenantId, didit_library_id: { $exists: true } }, '-created_date', 500));
  const map = new Map();
  for (const r of rules) if (r.didit_library_id && r.mode !== 'retired' && !map.has(r.didit_library_id)) map.set(r.didit_library_id, r);
  return map;
}

export async function listLibrary(ctx, { search, category, bundle, limit = 50, offset = 0 } = {}) {
  const page = await listLibraryRules(ctx.tenant, { search: clip(search, 80), category: clip(category, 40), bundle: clip(bundle, 40), limit: Math.min(Number(limit) || 50, 100), offset: Math.max(Number(offset) || 0, 0) });
  const imported = await importedMap(ctx.E, ctx.tenantId);
  return { count: page.count, next: page.next, rules: page.results.filter((r) => r?.library_key).map((r) => describe(r, imported)) };
}

/** Finds one library entry by key (search by its title first, then pages through the library). */
async function findLibraryItem(tenant, key, titleHint) {
  if (titleHint) {
    const hit = (await listLibraryRules(tenant, { search: clip(titleHint, 80), limit: 50 })).results.find((r) => r.library_key === key);
    if (hit) return hit;
  }
  for (let p = 0; p < 10; p++) {
    const page = await listLibraryRules(tenant, { limit: 100, offset: p * 100 });
    const hit = page.results.find((r) => r.library_key === key);
    if (hit) return hit;
    if (!page.next || page.results.length < 100) break;
  }
  return null;
}

/** Imports a Didit library rule as a Vitauri draft (mode draft, not in Didit until approved and synced). */
export async function importLibraryRule(ctx, body) {
  const key = clip(body.library_key, 120);
  if (!key) throw httpError(400, 'library_key is required');
  const existing = (await importedMap(ctx.E, ctx.tenantId)).get(key);
  if (existing) throw httpError(409, `This library rule was already imported as "${existing.name}" v${existing.version || 1}. Open that rule instead.`);
  const item = await findLibraryItem(ctx.tenant, key, body.title);
  if (!item) throw httpError(404, 'This rule is no longer in the Didit library');
  const { problem } = checkDefinition(item);
  if (problem) throw httpError(422, `This library rule uses settings the Vitauri rule editor does not support yet. ${problem}`);

  const saved = await saveRule(ctx, {
    definition: definitionOf(item), scenario_id: body.scenario_id || undefined, owner_user_id: body.owner_user_id || undefined,
    nl_source: item.description || '', change_note: `Imported from the Didit library (${item.title})`,
  });
  await ctx.E.TmRule.update(saved.rule_id, { source: 'didit_library', didit_library_id: key });
  await audit(ctx, 'tm_rule_imported_from_didit_library', {}, { rule_id: saved.rule_id, didit_library_id: key, mode: 'draft' },
    `Didit library rule "${item.title}" imported as a Vitauri draft by ${ctx.auth.actorName}. It needs approval before it runs.`);
  return { rule_id: saved.rule_id, version: saved.version };
}

const remoteId = (r) => r?.uuid || r?.id || null;

/** Lists every rule registered in Didit for this tenant (up to 500). */
async function allRemoteRules(tenant) {
  const out = [];
  for (let p = 0; p < 5; p++) {
    const page = await listRules(tenant, { limit: 100, offset: p * 100 });
    out.push(...page.results);
    if (!page.next || page.results.length < 100) break;
  }
  return out;
}

/**
 * Records Didit rules that run without a Vitauri rule behind them as read-only TmRule stubs (mode 'unmanaged').
 * Disabled Didit rules and rules Vitauri pushed itself are ignored. Notifies Compliance Admins once per new rule.
 */
export async function recordUnmanagedRules(ctx) {
  const { E, tenantId } = ctx;
  const remote = await allRemoteRules(ctx.tenant);
  const ours = asList(await E.TmRule.filter({ tenant_id: tenantId }, '-created_date', 2000));
  const known = new Set();
  for (const r of ours) {
    if (r.didit_rule_id) known.add(r.didit_rule_id);
    for (const h of r.didit_rule_history || []) { if (h.old_didit_rule_id) known.add(h.old_didit_rule_id); if (h.new_didit_rule_id) known.add(h.new_didit_rule_id); }
  }
  const fresh = remote.filter((r) => {
    const id = remoteId(r);
    return id && !known.has(id) && String(r.mode || '').toUpperCase() !== 'DISABLED' && !String(r.description || '').includes(MANAGED_MARK);
  });
  if (!fresh.length) return { found: 0, notified: 0 };

  const admins = (await tenantUsers(E, tenantId)).filter((u) => roleOf(u) === 'Compliance Admin');
  let notified = 0;
  const at = new Date().toISOString();
  for (const r of fresh) {
    const id = remoteId(r);
    const preset = String(r.source || '').toUpperCase() === 'PRESET';
    const rec = await E.TmRule.create({
      tenant_id: tenantId, name: clip(r.title || r.name || 'Didit rule', 120), version: 1, definition: definitionOf(r), mode: 'unmanaged',
      didit_rule_id: id, sync_status: 'not_synced', approval_status: 'not_requested', source: preset ? 'didit_library' : 'didit_console',
      ...(preset && r.library_key ? { didit_library_id: r.library_key } : {}), unmanaged_since: at,
      change_note: `Found in Didit (${String(r.mode || '').toUpperCase() || 'mode unknown'}) without a Vitauri rule`,
    });
    await audit(ctx, 'tm_rule_unmanaged_found', {}, { rule_id: rec.id, didit_rule_id: id, didit_mode: String(r.mode || '').toUpperCase() },
      `Didit runs rule "${rec.name}" (${String(r.mode || '').toUpperCase()}) that Vitauri does not manage. Adopt it or mark it as known.`);
    if (admins.length) {
      await E.Notification.bulkCreate(admins.map((u) => ({
        tenant_id: tenantId, user_id: u.id, type: 'tm_rule_unmanaged', is_read: false, dedupe_key: `${u.id}:rule:unmanaged:${id}`,
        title: `Rule running in Didit without Vitauri governance: ${rec.name}`,
        body: 'This rule was created in Didit, not in Vitauri. Open Rules → Unmanaged in Didit to adopt it (owner, scenario, approval) or mark it as known.',
      })));
      notified += admins.length;
    }
  }
  return { found: fresh.length, notified };
}

function loadUnmanaged(rule) {
  if (rule.mode !== 'unmanaged') throw httpError(409, 'This rule is not an unmanaged Didit rule');
  return rule;
}

/** Brings an unmanaged Didit rule under Vitauri governance as a draft. After approval the sync updates the same Didit rule. */
export async function adoptUnmanaged(ctx, rule, body) {
  loadUnmanaged(rule);
  let def;
  try { def = validateDefinition(definitionOf(rule.definition || {})); } catch (e) {
    throw httpError(422, `This Didit rule uses settings the Vitauri rule editor does not support, so it cannot be adopted. Mark it as known instead. ${e?.message || ''}`.trim());
  }
  if (body.scenario_id) {
    const sc = asList(await ctx.E.TmScenario.filter({ tenant_id: ctx.tenantId, id: body.scenario_id }))[0];
    if (!sc) throw httpError(404, 'Scenario not found');
  }
  if (body.review_date && !/^\d{4}-\d{2}-\d{2}$/.test(body.review_date)) throw httpError(400, 'review_date must be YYYY-MM-DD');
  const patch = {
    mode: 'draft', approval_status: 'not_requested', sync_status: 'not_synced', name: def.title, definition: def,
    scenario_id: body.scenario_id || rule.scenario_id || '', owner_user_id: body.owner_user_id || ctx.auth.actorUserId,
    review_date: body.review_date || rule.review_date || '', created_by_user_id: rule.created_by_user_id || ctx.auth.actorUserId,
    lineage_id: rule.lineage_id || crypto.randomUUID(), change_note: clip(body.change_note) || 'Adopted from Didit',
  };
  await ctx.E.TmRule.update(rule.id, patch);
  await audit(ctx, 'tm_rule_unmanaged_adopted', { mode: 'unmanaged' }, { rule_id: rule.id, mode: 'draft', didit_rule_id: rule.didit_rule_id },
    `Didit rule "${rule.name}" adopted into Vitauri by ${ctx.auth.actorName}. It keeps running in Didit as it is until the Vitauri version is approved and synced.`);
  return { rule_id: rule.id, mode: 'draft' };
}

/** Records that an unmanaged Didit rule is known and accepted as it is. */
export async function acknowledgeUnmanaged(ctx, rule, body) {
  loadUnmanaged(rule);
  const reason = clip(body.reason, 600);
  if (reason.length < 5) throw httpError(400, 'Give a short reason (at least 5 characters)');
  const patch = { unmanaged_ack_reason: reason, unmanaged_ack_by_user_id: ctx.auth.actorUserId, unmanaged_ack_at: new Date().toISOString() };
  await ctx.E.TmRule.update(rule.id, patch);
  await audit(ctx, 'tm_rule_unmanaged_acknowledged', { unmanaged_ack_reason: rule.unmanaged_ack_reason || null }, { rule_id: rule.id, unmanaged_ack_reason: reason },
    `Didit rule "${rule.name}" marked as known by ${ctx.auth.actorName}: ${reason}`);
  return { rule_id: rule.id };
}
