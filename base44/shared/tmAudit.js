// Batch-level AuditEvent writer for the TM pipeline.
export async function writeAudit(base44, auth, { tenantId, clientId, eventType, before, after, notes }) {
  return base44.asServiceRole.entities.AuditEvent.create({
    tenant_id: tenantId,
    client_id: clientId || undefined,
    actor_user_id: auth.actorUserId,
    actor_name: auth.actorName,
    actor_type: auth.actorType,
    event_type: eventType,
    before_state: before || {},
    after_state: after || {},
    notes,
  });
}