// Push / compare TmRules against Didit (Management API). Backend only: uses tenant.didit_api_key via diditTm.
import { asList, httpError, mapLimit } from './tmAuth.js';
import { writeAudit } from './tmAudit.js';
import { upsertRule, getRule } from './diditTm.js';
import { MODE_MAP, toDiditPayload, normalizeForCompare, diffParts, validateDefinition } from './tmRuleSchema.js';

export const errText = (e) => {
  const d = e?.detail;
  const s = typeof d === 'string' ? d : d ? JSON.stringify(d) : e?.message || String(e);
  return `${e?.status ? `(${e.status}) ` : ''}${s}`.slice(0, 300);
};

export const SYSTEM_AUTH = (name) => ({ actorType: 'System', actorName: name, actorUserId: undefined });

/**
 * Pushes the rule to Didit with the given Vitauri mode (default: the rule's own).
 * Never silently overwrites a console change: a drifted rule needs { force: true } (an explicit user choice).
 * Persists sync metadata. Returns { rule (merged), ok, error }.
 */
export async function syncRule(ctx, rule, { mode, force = false } = {}) {
  if (rule.sync_status === 'drift' && !force) throw httpError(409, 'This rule changed in Didit. Review it there, or push the Vitauri version deliberately.');
  const target = mode || rule.mode;
  const diditMode = MODE_MAP[target] || 'DISABLED';
  let patch;
  let ok = true;
  try {
    const def = validateDefinition(rule.definition);
    const payload = toDiditPayload({ ...rule, definition: def }, diditMode);
    let res;
    try {
      res = await upsertRule(ctx.tenant, payload, rule.didit_rule_id);
    } catch (e) {
      if (e?.status === 404 && rule.didit_rule_id && force) res = await upsertRule(ctx.tenant, payload, undefined);
      else throw e;
    }
    const id = res?.uuid || res?.id || rule.didit_rule_id;
    if (!id) throw { detail: 'Didit did not return a rule id' };
    patch = { didit_rule_id: id, sync_status: 'synced', last_synced_at: new Date().toISOString(), sync_error: '', drift_detected_at: '' };
  } catch (e) {
    ok = false;
    patch = { sync_status: 'failed', sync_error: errText(e) };
  }
  await ctx.E.TmRule.update(rule.id, patch);
  await writeAudit(ctx.base44, ctx.auth, {
    tenantId: ctx.tenantId, eventType: ok ? 'tm_rule_synced' : 'tm_rule_sync_failed',
    before: { sync_status: rule.sync_status, didit_rule_id: rule.didit_rule_id || null },
    after: { sync_status: patch.sync_status, didit_mode: diditMode, didit_rule_id: patch.didit_rule_id || rule.didit_rule_id || null, error: patch.sync_error || undefined },
    notes: ok ? `Rule "${rule.name}" v${rule.version} pushed to Didit as ${diditMode}.` : `Pushing rule "${rule.name}" v${rule.version} to Didit failed: ${patch.sync_error}`,
  });
  return { rule: { ...rule, ...patch }, ok, error: ok ? '' : patch.sync_error };
}

async function notifyOwners(E, tenantId, rule, parts) {
  const uid = rule.owner_user_id || rule.created_by_user_id;
  if (!uid) return 0;
  await E.Notification.create({
    tenant_id: tenantId, user_id: uid, type: 'tm_rule_drift', is_read: false,
    dedupe_key: `${uid}:rule:${rule.id}:drift:${rule.drift_detected_at || Date.now()}`,
    title: `Rule changed in Didit: ${rule.name} (v${rule.version})`,
    body: `The Didit version differs in: ${parts.join(', ')}. Vitauri did not overwrite it. Open Rules to review.`,
  });
  return 1;
}

/** Compares one synced rule with Didit. Returns 'drift' | 'cleared' | 'same' | 'error'. */
async function checkRule(ctx, rule) {
  let remote;
  try {
    remote = await getRule(ctx.tenant, rule.didit_rule_id);
  } catch (e) {
    if (e?.status !== 404) return { state: 'error', error: errText(e) };
    remote = null;
  }
  const expectedMode = MODE_MAP[rule.mode] || 'DISABLED';
  const parts = remote ? diffParts(normalizeForCompare(rule.definition), normalizeForCompare(remote)) : ['rule deleted in Didit'];
  if (remote && String(remote.mode || '').toUpperCase() !== expectedMode) parts.push(`mode (Didit ${String(remote.mode).toUpperCase()}, Vitauri ${expectedMode})`);

  if (parts.length && rule.sync_status === 'synced') {
    const at = new Date().toISOString();
    await ctx.E.TmRule.update(rule.id, { sync_status: 'drift', drift_detected_at: at, sync_error: `Changed in Didit: ${parts.join(', ')}` });
    await writeAudit(ctx.base44, ctx.auth, { tenantId: ctx.tenantId, eventType: 'tm_rule_drift_detected', before: { sync_status: 'synced' }, after: { sync_status: 'drift', differs: parts }, notes: `Rule "${rule.name}" v${rule.version} differs in Didit: ${parts.join(', ')}.` });
    const n = await notifyOwners(ctx.E, ctx.tenantId, { ...rule, drift_detected_at: at }, parts);
    return { state: 'drift', notified: n };
  }
  if (!parts.length && rule.sync_status === 'drift') {
    await ctx.E.TmRule.update(rule.id, { sync_status: 'synced', drift_detected_at: '', sync_error: '' });
    await writeAudit(ctx.base44, ctx.auth, { tenantId: ctx.tenantId, eventType: 'tm_rule_drift_cleared', before: { sync_status: 'drift' }, after: { sync_status: 'synced' }, notes: `Rule "${rule.name}" v${rule.version} matches Didit again.` });
    return { state: 'cleared' };
  }
  return { state: parts.length ? 'drift' : 'same' };
}

/** Drift check for every synced rule of one tenant. Never writes to Didit. */
export async function driftCheckTenant(base44, tenant) {
  const E = base44.asServiceRole.entities;
  const ctx = { base44, E, tenant, tenantId: tenant.id, auth: SYSTEM_AUTH('Nightly Didit rule drift check') };
  const rules = asList(await E.TmRule.filter({ tenant_id: tenant.id, sync_status: { $in: ['synced', 'drift'] }, didit_rule_id: { $exists: true } }, undefined, 500))
    .filter((r) => r.didit_rule_id);
  const out = await mapLimit(rules, 3, (r) => checkRule(ctx, r));
  const res = { tenant_id: tenant.id, checked: rules.length, drift: 0, cleared: 0, notified: 0, errors: [] };
  out.forEach((o, i) => {
    const v = o.ok ? o.value : { state: 'error', error: errText(o.error) };
    if (v.state === 'drift') res.drift++;
    if (v.state === 'cleared') res.cleared++;
    res.notified += v.notified || 0;
    if (v.state === 'error') res.errors.push({ rule_id: rules[i].id, error: v.error });
  });
  if (res.errors.length) {
    await writeAudit(base44, ctx.auth, { tenantId: tenant.id, eventType: 'tm_rule_drift_check_failed', before: {}, after: { errors: res.errors.slice(0, 10) }, notes: `Drift check could not read ${res.errors.length} rule(s) from Didit. It will retry on the next run.` });
  }
  return res;
}