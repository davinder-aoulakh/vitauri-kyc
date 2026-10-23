// recordModelValidation — records a periodic validation of the monitoring model (rules, scenarios, AI triage)
// with its outcome and the next due date. Compliance Officer and above. ModelValidation is backend-write only.
//   { validated_at, scope, outcome: passed|passed_with_findings|failed, findings?, validator?, next_due_at, evidence_url? }
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.52';
import { isTmEnabled } from '../../shared/tmGuards.js';
import { writeAudit } from '../../shared/tmAudit.js';
import { authenticate, errorResponse, httpError, loadTenant } from '../../shared/tmAuth.js';

const ROLES = ['Compliance Officer', 'Compliance Admin', 'Director', 'Tenant Admin'];
const OUTCOMES = ['passed', 'passed_with_findings', 'failed'];
const DATE_RE = /^\d{4}-\d{2}-\d{2}/;

export default async function (req) {
  try {
    const base44 = createClientFromRequest(req);
    const body = await req.json();
    const auth = await authenticate(base44, req, body, { roles: ROLES, allowApiKey: false });
    const tenantId = auth.tenantId;
    const tenant = await loadTenant(base44, tenantId);
    if (!isTmEnabled(tenant, 'tm_quality')) throw httpError(403, 'Feature tm_quality is not enabled');

    const scope = String(body.scope || '').trim().slice(0, 300);
    const outcome = String(body.outcome || '');
    const validatedAt = String(body.validated_at || '');
    const nextDue = String(body.next_due_at || '').slice(0, 10);
    if (!scope) throw httpError(400, 'scope is required');
    if (!OUTCOMES.includes(outcome)) throw httpError(400, 'outcome must be passed, passed_with_findings or failed');
    if (!DATE_RE.test(validatedAt) || !DATE_RE.test(nextDue)) throw httpError(400, 'validated_at and next_due_at must be dates');
    if (nextDue <= validatedAt.slice(0, 10)) throw httpError(400, 'next_due_at must be after validated_at');
    const findings = String(body.findings || '').trim().slice(0, 4000);
    if (outcome !== 'passed' && !findings) throw httpError(400, 'Describe the findings');

    const rec = await base44.asServiceRole.entities.ModelValidation.create({
      tenant_id: tenantId,
      validated_at: new Date(validatedAt).toISOString(),
      scope, outcome, findings: findings || undefined,
      validator: String(body.validator || '').trim().slice(0, 200) || undefined,
      evidence_url: String(body.evidence_url || '').trim().slice(0, 1000) || undefined,
      next_due_at: nextDue,
      owner_user_id: auth.actorUserId, owner_name: auth.actorName, recorded_by_user_id: auth.actorUserId,
    });
    await writeAudit(base44, auth, {
      tenantId, eventType: 'tm_model_validation_recorded',
      after: { model_validation_id: rec.id, scope, outcome, next_due_at: nextDue },
      notes: `Model validation recorded by ${auth.actorName}: ${scope} — ${outcome.replace(/_/g, ' ')}; next due ${nextDue}.`,
    });
    return Response.json({ ok: true, id: rec.id });
  } catch (error) {
    return errorResponse(error);
  }
}
