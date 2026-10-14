// Lifecycle of a TmRule: save (versioning), request approval, approve / reject (4-eyes), set mode, retire.
// Every state change writes an AuditEvent. Only approved rules can be switched to test / active / disabled.
import { asList, httpError } from './tmAuth.js';
import { writeAudit } from './tmAudit.js';
import { tenantUsers, roleOf } from './tmCaseCommon.js';
import { APPROVE_ROLES, validateDefinition, definitionKey } from './tmRuleSchema.js';
import { syncRule } from './tmRuleSync.js';

const MODES = ['test', 'active', 'disabled'];
const clip = (s, n = 400) => String(s ?? '').trim().slice(0, n);

export async function loadRule(E, tenantId, id) {
  if (!id) throw httpError(400, 'rule_id is required');
  const r = asList(await E.TmRule.filter({ tenant_id: tenantId, id }))[0];
  if (!r || r.tenant_id !== tenantId) throw httpError(404, 'Rule not found');
  return r;
}

const audit = (ctx, type, before, after, notes) => writeAudit(ctx.base44, ctx.auth, { tenantId: ctx.tenantId, eventType: type, before, after, notes });
const label = (r) => `"${r.name}" v${r.version || 1}`;
const frozen = (r) => r.mode !== 'draft' || r.approval_status === 'approved';

async function lineage(ctx, rule) {
  const key = rule.lineage_id;
  if (!key) return [rule];
  return asList(await ctx.E.TmRule.filter({ tenant_id: ctx.tenantId, lineage_id: key }, 'version', 100));
}

async function notify(ctx, userIds, type, title, body, dedupe) {
  const ids = [...new Set(userIds.filter(Boolean))];
  if (!ids.length) return 0;
  await ctx.E.Notification.bulkCreate(ids.map((uid) => ({ tenant_id: ctx.tenantId, user_id: uid, type, title, body, is_read: false, dedupe_key: `${uid}:${dedupe}` })));
  return ids.length;
}

/** Create (no rule_id), edit in place, or branch a new version when the rule is already approved / live. */
export async function saveRule(ctx, body) {
  const { E, tenantId, auth } = ctx;
  const def = validateDefinition(body.definition);
  const note = clip(body.change_note);
  const meta = {};
  for (const k of ['scenario_id', 'owner_user_id', 'review_date']) if (body[k] !== undefined) meta[k] = body[k] || '';
  if (meta.review_date && !/^\d{4}-\d{2}-\d{2}$/.test(meta.review_date)) throw httpError(400, 'review_date must be YYYY-MM-DD');
  if (meta.scenario_id) {
    const sc = asList(await E.TmScenario.filter({ tenant_id: tenantId, id: meta.scenario_id }))[0];
    if (!sc) throw httpError(404, 'Scenario not found');
  }

  if (!body.rule_id) {
    const rec = await E.TmRule.create({
      ...meta, tenant_id: tenantId, name: def.title, version: 1, definition: def, nl_source: clip(body.nl_source, 2000) || undefined, mode: 'draft',
      sync_status: 'not_synced', approval_status: 'not_requested', created_by_user_id: auth.actorUserId, owner_user_id: meta.owner_user_id || auth.actorUserId,
      lineage_id: crypto.randomUUID(), change_note: note || 'Created',
    });
    await audit(ctx, 'tm_rule_created', {}, { rule_id: rec.id, version: 1, mode: 'draft' }, `Rule ${label(rec)} created as a draft by ${auth.actorName}.`);
    return { rule_id: rec.id, version: 1, created: true };
  }

  const rule = await loadRule(E, tenantId, body.rule_id);
  if (rule.mode === 'retired') throw httpError(409, 'A retired rule cannot be edited. Start a new rule instead.');
  const defChanged = definitionKey(def) !== definitionKey(rule.definition);

  if (!defChanged) {
    if (!Object.keys(meta).length && !note) return { rule_id: rule.id, version: rule.version, unchanged: true };
    const patch = { ...meta, ...(note ? { change_note: note } : {}) };
    await E.TmRule.update(rule.id, patch);
    await audit(ctx, 'tm_rule_updated', Object.fromEntries(Object.keys(patch).map((k) => [k, rule[k] ?? null])), patch, `Details of rule ${label(rule)} updated by ${auth.actorName}.`);
    return { rule_id: rule.id, version: rule.version };
  }

  if (!frozen(rule)) {
    const patch = { name: def.title, definition: def, backtest_id: '', approval_status: 'not_requested', sync_status: rule.didit_rule_id ? 'not_synced' : rule.sync_status, ...meta, change_note: note || rule.change_note };
    await E.TmRule.update(rule.id, patch);
    await audit(ctx, 'tm_rule_updated', { definition_changed: false }, { definition_changed: true, backtest_cleared: !!rule.backtest_id }, `Draft ${label(rule)} edited by ${auth.actorName}. A new backtest is required.`);
    return { rule_id: rule.id, version: rule.version, backtest_cleared: !!rule.backtest_id };
  }

  const family = await lineage(ctx, rule);
  const open = family.find((r) => r.id !== rule.id && r.mode === 'draft' && r.approval_status !== 'approved');
  if (open) throw httpError(409, `Version ${open.version} is still a draft. Edit that version instead.`);
  const version = Math.max(...family.map((r) => r.version || 1)) + 1;
  const rec = await E.TmRule.create({
    tenant_id: tenantId, name: def.title, scenario_id: rule.scenario_id, version, definition: def, nl_source: rule.nl_source, mode: 'draft', sync_status: 'not_synced',
    approval_status: 'not_requested', created_by_user_id: auth.actorUserId, owner_user_id: rule.owner_user_id, review_date: rule.review_date,
    previous_version_id: rule.id, lineage_id: rule.lineage_id || crypto.randomUUID(), change_note: note || `Edited from v${rule.version}`, ...meta,
  });
  await audit(ctx, 'tm_rule_version_created', { rule_id: rule.id, version: rule.version, mode: rule.mode }, { rule_id: rec.id, version, mode: 'draft' }, `New draft version ${version} of "${def.title}" created by ${auth.actorName}. Version ${rule.version} stays as it is.`);
  return { rule_id: rec.id, version, new_version: true };
}

export async function requestApproval(ctx, rule) {
  if (rule.mode !== 'draft') throw httpError(409, 'Only a draft can be sent for approval');
  if (rule.approval_status === 'requested') throw httpError(409, 'Approval has already been requested');
  if (rule.approval_status === 'approved') throw httpError(409, 'This version is already approved');
  validateDefinition(rule.definition);
  const gaps = approvalGaps(rule);
  if (!rule.backtest_id) gaps.push('a backtest on this version');
  if (gaps.length) throw httpError(422, `Before approval, add: ${gaps.join(', ')}`);
  const now = new Date().toISOString();
  await ctx.E.TmRule.update(rule.id, { approval_status: 'requested', requested_by_user_id: ctx.auth.actorUserId, requested_at: now, rejection_reason: '' });
  const approvers = (await tenantUsers(ctx.E, ctx.tenantId)).filter((u) => APPROVE_ROLES.includes(roleOf(u)) && u.id !== ctx.auth.actorUserId && u.id !== rule.created_by_user_id);
  const n = await notify(ctx, approvers.map((u) => u.id), 'tm_rule_approval', `Rule needs approval: ${rule.name} (v${rule.version})`, `${ctx.auth.actorName} asked for a second pair of eyes. Open Rules to review.`, `rule:${rule.id}:approval:${now}`);
  await audit(ctx, 'tm_rule_approval_requested', { approval_status: rule.approval_status || 'not_requested' }, { approval_status: 'requested', notified: n }, `Approval requested for ${label(rule)} by ${ctx.auth.actorName}.`);
  return { rule_id: rule.id, approval_status: 'requested', notified: n };
}

function approvalGaps(rule) {
  const gaps = [];
  if (!rule.scenario_id) gaps.push('a linked scenario');
  if (!rule.owner_user_id) gaps.push('an owner');
  if (!rule.review_date) gaps.push('a review date');
  return gaps;
}

export async function approveRule(ctx, rule, body) {
  const { E, auth } = ctx;
  if (rule.approval_status !== 'requested' || rule.mode !== 'draft') throw httpError(409, 'Only a rule waiting for approval can be approved');
  if (auth.actorUserId === rule.created_by_user_id || auth.actorUserId === rule.requested_by_user_id) throw httpError(403, 'The approver must be a different person from the one who created or requested the rule');
  validateDefinition(rule.definition);
  const gaps = approvalGaps(rule);
  if (gaps.length) throw httpError(422, `The rule is missing ${gaps.join(', ')}`);
  if (rule.review_date < new Date().toISOString().slice(0, 10)) throw httpError(422, 'The review date is in the past');
  const bt = rule.backtest_id ? asList(await E.RuleBacktest.filter({ tenant_id: ctx.tenantId, id: rule.backtest_id }))[0] : null;
  if (!bt || bt.rule_id !== rule.id || (bt.rule_version || 1) !== (rule.version || 1)) throw httpError(422, 'A backtest on this exact version is required');

  const now = new Date().toISOString();
  await E.TmRule.update(rule.id, { approval_status: 'approved', approved_by_user_id: auth.actorUserId, approved_at: now, rejection_reason: '' });
  await audit(ctx, 'tm_rule_approved', { approval_status: 'requested' }, { approval_status: 'approved', backtest_id: bt.id, rationale: clip(body.rationale) || undefined }, `Rule ${label(rule)} approved by ${auth.actorName}.`);
  // Registered in Didit as DISABLED so it stays inert until someone explicitly enables it. A sync failure does not undo the approval.
  const sync = await syncRule(ctx, { ...rule, approval_status: 'approved' }, { mode: 'disabled' });
  await notify(ctx, [rule.created_by_user_id, rule.requested_by_user_id], 'tm_rule_approval', `Rule approved: ${rule.name} (v${rule.version})`, 'You can now start it in test mode.', `rule:${rule.id}:approved:${now}`);
  return { rule_id: rule.id, approval_status: 'approved', sync_status: sync.rule.sync_status, sync_error: sync.error || undefined };
}

export async function rejectRule(ctx, rule, body) {
  if (rule.approval_status !== 'requested') throw httpError(409, 'Only a rule waiting for approval can be sent back');
  const why = clip(body.reason);
  if (why.length < 5) throw httpError(400, 'A reason is required');
  if (ctx.auth.actorUserId === rule.created_by_user_id) throw httpError(403, 'The creator cannot decide on their own rule');
  await ctx.E.TmRule.update(rule.id, { approval_status: 'rejected', rejection_reason: why });
  await notify(ctx, [rule.created_by_user_id, rule.requested_by_user_id], 'tm_rule_approval', `Rule sent back: ${rule.name} (v${rule.version})`, why, `rule:${rule.id}:rejected:${Date.now()}`);
  await audit(ctx, 'tm_rule_rejected', { approval_status: 'requested' }, { approval_status: 'rejected', reason: why }, `Rule ${label(rule)} sent back by ${ctx.auth.actorName}: ${why}`);
  return { rule_id: rule.id, approval_status: 'rejected' };
}

/** Push the target mode to Didit FIRST; the Vitauri mode only changes when Didit accepted it. */
export async function setMode(ctx, rule, { mode }) {
  if (!MODES.includes(mode)) throw httpError(400, 'mode must be test, active or disabled');
  if (rule.approval_status !== 'approved') throw httpError(409, 'Only an approved rule can change mode');
  if (rule.mode === 'retired') throw httpError(409, 'A retired rule cannot change mode');
  if (rule.mode === mode) throw httpError(409, `The rule is already ${mode}`);
  const res = await syncRule(ctx, rule, { mode });
  if (!res.ok) throw httpError(502, `Didit did not accept the change: ${res.error}`);
  await ctx.E.TmRule.update(rule.id, { mode });
  await audit(ctx, 'tm_rule_mode_changed', { mode: rule.mode }, { mode, didit_rule_id: res.rule.didit_rule_id }, `Rule ${label(rule)} changed from ${rule.mode} to ${mode} by ${ctx.auth.actorName}.`);

  const warnings = [];
  if (mode === 'active' || mode === 'test') {
    const older = (await lineage(ctx, rule)).filter((r) => r.id !== rule.id && (r.version || 1) < (rule.version || 1) && ['active', 'test'].includes(r.mode));
    for (const old of older) {
      const off = await syncRule(ctx, old, { mode: 'disabled', force: true });
      if (!off.ok) { warnings.push(`Version ${old.version} could not be switched off in Didit: ${off.error}`); continue; }
      await ctx.E.TmRule.update(old.id, { mode: 'retired', retired_at: new Date().toISOString(), retired_by_user_id: ctx.auth.actorUserId });
      await audit(ctx, 'tm_rule_retired', { mode: old.mode }, { mode: 'retired', replaced_by: rule.id }, `Rule ${label(old)} replaced by version ${rule.version}.`);
    }
  }
  return { rule_id: rule.id, mode, sync_status: 'synced', warnings };
}

export async function retireRule(ctx, rule, body) {
  if (rule.mode === 'retired') throw httpError(409, 'The rule is already retired');
  const why = clip(body.reason);
  if (why.length < 5) throw httpError(400, 'A reason is required');
  if (rule.didit_rule_id) {
    const off = await syncRule(ctx, rule, { mode: 'disabled', force: rule.sync_status === 'drift' });
    if (!off.ok) throw httpError(502, `Didit did not accept the change: ${off.error}`);
  }
  await ctx.E.TmRule.update(rule.id, { mode: 'retired', retired_at: new Date().toISOString(), retired_by_user_id: ctx.auth.actorUserId, change_note: why });
  await audit(ctx, 'tm_rule_retired', { mode: rule.mode }, { mode: 'retired', reason: why }, `Rule ${label(rule)} retired by ${ctx.auth.actorName}: ${why}`);
  return { rule_id: rule.id, mode: 'retired' };
}