// Guided conversation outreach: one builder for every audit event of spec section 12. Event names get the prefix
// "outreach." and are written by backend functions only. Personal data goes into payload, never into notes.
export const OUTREACH_EVENT_PREFIX = 'outreach.';

/**
 * actor: { type: 'User' | 'Client' | 'System' | 'AI_Agent', id?, name? }. conversation: { id, request_id, case_id, client_id, party_id }.
 * Returns an AuditEvent row.
 */
export function outreachAuditRow({ tenantId, event, actor = { type: 'System' }, conversation = {}, payload = {}, notes = '', before, after }) {
  const name = String(event || '').replace(/^outreach\./, '');
  if (!name) throw new Error('event is required');
  return {
    tenant_id: tenantId,
    event_type: `${OUTREACH_EVENT_PREFIX}${name}`,
    actor_type: actor.type || 'System',
    actor_user_id: actor.type === 'User' ? actor.id : undefined,
    actor_name: actor.name || (actor.type === 'Client' ? 'Client' : 'System'),
    case_id: conversation.case_id || undefined,
    client_id: conversation.client_id || undefined,
    outreach_request_id: conversation.request_id || undefined,
    related_party_id: conversation.party_id || undefined,
    payload: { conversation_id: conversation.id || undefined, ...payload },
    ...(before ? { before_state: before } : {}),
    ...(after ? { after_state: after } : {}),
    notes: String(notes || '').slice(0, 1000),
  };
}

/** Writes the row; an audit failure never breaks the caller, but is logged. */
export async function writeOutreachAudit(E, row) {
  try { return await E.AuditEvent.create(row); } catch (e) { console.warn('outreach audit failed', e?.message); return null; }
}
