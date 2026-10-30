import { createClientFromRequest } from 'npm:@base44/sdk@0.8.44';

// Creates a Client, its client_created AuditEvent and the Onboarding KycCase in
// one round trip. Writes run as the signed-in user (same RLS as the browser path).
const CREATE_ROLES = ['Analyst', 'QC Reviewer', 'Compliance Officer', 'Manager', 'Director', 'Compliance Admin', 'Tenant Admin', 'Vitauri Ops'];

function addDaysIso(days) {
  const d = new Date(Date.now() + days * 86400000);
  return d.toISOString().slice(0, 10);
}

export default async function(req) {
  const t0 = Date.now();
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const tenantId = user.tenant_id || user.data?.tenant_id;
    const appRole = user.app_role || user.data?.app_role;
    const fullName = user.full_name || user.data?.full_name || user.email;
    if (!tenantId) return Response.json({ error: 'No tenant associated with this user' }, { status: 400 });
    if (!CREATE_ROLES.includes(appRole)) return Response.json({ error: 'You do not have permission to create clients' }, { status: 403 });

    let body = {};
    try { body = await req.json(); } catch { body = {}; }
    const { client: clientData, client_type: clientType, audit_after_state: auditAfter, step_config: stepConfig, due_date: dueDate } = body || {};
    if (!clientData || typeof clientData !== 'object') return Response.json({ error: 'client is required' }, { status: 400 });
    if (!['NP', 'ORG'].includes(clientType)) return Response.json({ error: 'client_type must be NP or ORG' }, { status: 400 });

    const steps = {};
    for (const [k, v] of Object.entries(stepConfig || {})) {
      if (/^step_\d+_not_required$/.test(k) && typeof v === 'boolean') steps[k] = v;
    }

    const client = await base44.entities.Client.create({
      ...clientData,
      tenant_id: tenantId,
      client_type: clientType,
      status: 'Prospect',
    });
    const tClient = Date.now();

    const [, kycCase] = await Promise.all([
      base44.entities.AuditEvent.create({
        tenant_id: tenantId,
        client_id: client.id,
        actor_user_id: user.id,
        actor_name: fullName,
        actor_type: 'User',
        event_type: 'client_created',
        after_state: auditAfter || { ...clientData, client_type: clientType },
      }),
      base44.entities.KycCase.create({
        tenant_id: tenantId,
        client_id: client.id,
        case_type: 'Onboarding',
        status: 'Draft',
        assigned_analyst_id: user.id,
        due_date: /^\d{4}-\d{2}-\d{2}$/.test(dueDate || '') ? dueDate : addDaysIso(30),
        created_by_user_id: user.id,
        ...steps,
      }),
    ]);
    const tDone = Date.now();

    return Response.json({
      client,
      kycCase,
      timings: { client_ms: tClient - t0, case_and_audit_ms: tDone - tClient, total_ms: tDone - t0 },
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}
