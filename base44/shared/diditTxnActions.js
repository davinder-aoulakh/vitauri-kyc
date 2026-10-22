// Follow-up handling after a Didit transaction update (TM path, tm_core on):
//  - a later APPROVED / DECLINED on a transaction that raised an alert is recorded on the alert's client/case,
//  - action_required (docs.didit.me: { type: 'verification_session' | 'wallet_ownership', url, session_id, ... })
//    becomes an EDR proposal (verification_session) or an audit note (wallet_ownership).
// Alerts are never auto-closed. Never logs secrets; the end-user session URL is not stored.
import { asList } from './tmAuth.js';
import { proposeTriggers } from './edrTriggers.js';

const ALERTING = ['IN_REVIEW', 'DECLINED', 'AWAITING_USER'];
const OPEN_ALERT = ['new', 'triaged', 'in_review', 'escalated'];
const SYSTEM = { actorType: 'System', actorName: 'Didit Transaction Monitoring' };

export async function afterTransactionUpdate(base44, tenant, txn, prevStatus, newStatus, rec) {
  const E = base44.asServiceRole.entities;
  const tenantId = tenant.id;

  // 1. Status moved on after an alert: note it, raise priority on DECLINED, add to the TM case timeline.
  if (ALERTING.includes(prevStatus) && ['APPROVED', 'DECLINED'].includes(newStatus) && prevStatus !== newStatus) {
    const alerts = asList(await E.TmAlert.filter({ tenant_id: tenantId, client_id: txn.client_id, status: { $in: OPEN_ALERT } }, '-created_date', 50))
      .filter((a) => (a.transaction_ids || []).includes(txn.id));
    for (const a of alerts) {
      if (newStatus === 'DECLINED') {
        const priority = Math.min(100, Math.max(a.priority || 0, (a.score || 0) + 10));
        if (priority !== a.priority) await E.TmAlert.update(a.id, { priority }).catch(() => {});
      }
      if (a.tm_case_id) {
        const tmCase = asList(await E.TmCase.filter({ tenant_id: tenantId, id: a.tm_case_id }, undefined, 1))[0];
        if (tmCase) {
          const entry = { at: new Date().toISOString(), kind: 'didit_status', by: SYSTEM.actorName, ref_id: txn.id, text: `Didit changed transaction ${txn.our_transaction_id || txn.id} from ${prevStatus} to ${newStatus}.` };
          await E.TmCase.update(tmCase.id, { timeline: [...(tmCase.timeline || []), entry] }).catch(() => {});
        }
      }
    }
    await E.AuditEvent.create({
      tenant_id: tenantId, client_id: txn.client_id, actor_type: 'System', actor_name: SYSTEM.actorName, event_type: 'tm_transaction_status_changed',
      before_state: { status: prevStatus }, after_state: { status: newStatus, transaction_id: txn.id, tm_alert_ids: alerts.map((a) => a.id) },
      notes: `Didit ${newStatus === 'DECLINED' ? 'declined' : 'approved'} transaction ${txn.our_transaction_id || txn.id} after review (${alerts.length} open alert(s)).`,
    }).catch(() => {});
  }

  // 2. Pending end-user action.
  const action = rec?.action_required;
  if (!action || typeof action !== 'object') return;
  if (action.type === 'verification_session') {
    const client = asList(await E.Client.filter({ tenant_id: tenantId, id: txn.client_id }, undefined, 1))[0];
    if (!client) return;
    await proposeTriggers(E, {
      tenantId, client, sourceRef: `transaction:${txn.id}`, actor: SYSTEM,
      findings: [{
        type: 'transaction_verification', key: `transaction_verification:${txn.id}`, before: {},
        after: { transaction_id: txn.id, didit_transaction_id: txn.didit_transaction_id || rec.uuid || null, didit_session_id: action.session_id || null, session_status: action.status || null },
        summary: `Didit requires ${client.client_type === 'ORG' ? 'business (KYB)' : 'identity'} re-verification before transaction ${txn.our_transaction_id || txn.id} can proceed`,
      }],
    });
  } else if (action.type === 'wallet_ownership') {
    await E.AuditEvent.create({
      tenant_id: tenantId, client_id: txn.client_id, actor_type: 'System', actor_name: SYSTEM.actorName, event_type: 'tm_wallet_ownership_required',
      after_state: { transaction_id: txn.id }, notes: `Didit requires proof of wallet ownership for transaction ${txn.our_transaction_id || txn.id} (Travel Rule).`,
    }).catch(() => {});
  }
}
