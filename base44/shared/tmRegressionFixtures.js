// Seed fixtures for the TM regression harness. Payload {{tokens}} are filled with test-record ids at replay time.
// Terminal/data session events make Didit fetch the decision with the tenant's API key; the placeholder session ids
// below are unknown to Didit, so those fixtures expect "no change". Put a real session_id in the payload to exercise the full path.
const SESSION = (status, webhook_type = 'status.updated', extra = {}) => ({
  webhook_type, session_id: '{{session_id}}', status, event_id: '{{event_id}}', vendor_data: '{{client_id}}',
  metadata: { tenant_id: '{{tenant_id}}', outreach_id: '{{outreach_id}}', item_id: '{{item_id}}' }, ...extra,
});
const TXN = (webhook_type, status) => ({
  webhook_type, status, event_id: '{{event_id}}', transaction_id: '{{didit_transaction_id}}',
  subject: { vendor_data: '{{client_id}}' },
  metadata: { tenant_id: '{{tenant_id}}', our_transaction_id: '{{our_transaction_id}}' },
});

const UNCHANGED = {
  outreach_idv_status: 'Pending', outreach_session_status: 'Not Started', case_step_2_status: 'not_started',
  monitoring_alert_count: 0, tm_alert_count: 0,
};
const sessionFixture = (order, name, status, webhook_type) => ({
  name, kind: 'session', order, setup_group: `session-${order}`, webhook_type: webhook_type || 'status.updated',
  payload: SESSION(status, webhook_type || 'status.updated'),
  expected: { off: UNCHANGED, on: UNCHANGED, identical: true },
  notes: 'Placeholder session id: Didit has no decision to fetch, so nothing may change in either mode.',
});

export const SEED_FIXTURES = [
  sessionFixture(1, 'Session Approved', 'Approved'),
  sessionFixture(2, 'Session Declined', 'Declined'),
  sessionFixture(3, 'Session In Review', 'In Review'),
  sessionFixture(4, 'Session Abandoned', 'Abandoned'),
  {
    name: 'Session Resubmitted', kind: 'session', order: 5, setup_group: 'session-5', webhook_type: 'status.updated',
    payload: SESSION('Resubmitted', 'status.updated', { resubmit_info: { nodes_to_resubmit: ['ocr'], reasons: { ocr: 'blurry' } } }),
    expected: {
      off: { ...UNCHANGED, outreach_session_status: 'Resubmitted' },
      on: { ...UNCHANGED, outreach_session_status: 'Resubmitted' },
      identical: true,
    },
    notes: 'Item is reset to Requested / Pending with session status Resubmitted.',
  },
  {
    name: 'Session Kyc Expired', kind: 'session', order: 6, setup_group: 'session-6', webhook_type: 'status.updated',
    payload: SESSION('Kyc Expired'),
    expected: {
      off: { ...UNCHANGED, monitoring_alert_count: 1, monitoring_alert_types: ['Didit_Ongoing_High_Risk'] },
      on: { ...UNCHANGED, monitoring_alert_count: 1, monitoring_alert_types: ['Didit_Ongoing_High_Risk'] },
      identical: true,
    },
    notes: 'One Didit_Ongoing_High_Risk monitoring alert.',
  },
  sessionFixture(7, 'data.updated', 'In Progress', 'data.updated'),
  {
    name: 'user.status.updated (ongoing monitoring PEP hit)', kind: 'user', order: 8, setup_group: 'user-8', webhook_type: 'user.status.updated',
    payload: {
      webhook_type: 'user.status.updated', status: 'Approved', event_id: '{{event_id}}', vendor_data: '{{client_id}}',
      decision: { aml_screenings: [{ id: 'reg-screening-1', total_hits: 1, hits: [{ id: 'reg-hit-1', pep_matches: [{ name: 'Test Politician' }] }] }] },
    },
    expected: {
      off: { ...UNCHANGED, monitoring_alert_count: 1, monitoring_alert_types: ['Didit_Ongoing_PEP'] },
      on: { ...UNCHANGED, monitoring_alert_count: 1, monitoring_alert_types: ['Didit_Ongoing_PEP'] },
      identical: false,
    },
    notes: 'Tenant is resolved from the client (no session metadata).',
  },
  {
    name: 'transaction.created', kind: 'transaction', order: 9, setup_group: 'txn', webhook_type: 'transaction.created',
    payload: TXN('transaction.created', 'PENDING'),
    expected: {
      off: { transaction_status: 'PENDING', monitoring_alert_count: 0, tm_alert_count: 0 },
      on: { transaction_status: 'PENDING', monitoring_alert_count: 0, tm_alert_count: 0 },
      identical: false,
    },
    notes: 'No alert for a PENDING transaction.',
  },
  {
    name: 'transaction.status.updated IN_REVIEW (1st)', kind: 'transaction', order: 10, setup_group: 'txn', webhook_type: 'transaction.status.updated',
    payload: TXN('transaction.status.updated', 'IN_REVIEW'),
    expected: {
      off: { transaction_status: 'IN_REVIEW', monitoring_alert_count: 1, monitoring_alert_types: ['Screening_Hit'], tm_alert_count: 0 },
      on: { transaction_status: 'IN_REVIEW', monitoring_alert_count: 1, monitoring_alert_types: ['Transaction_Rule_Hit'], tm_alert_count: 1 },
      identical: false,
    },
    notes: 'OFF: legacy Screening_Hit. ON: one TmAlert and one Transaction_Rule_Hit.',
  },
  {
    name: 'transaction.status.updated IN_REVIEW (2nd)', kind: 'transaction', order: 11, setup_group: 'txn', webhook_type: 'transaction.status.updated',
    payload: TXN('transaction.status.updated', 'IN_REVIEW'),
    expected: {
      off: { transaction_status: 'IN_REVIEW', monitoring_alert_count: 2, monitoring_alert_types: ['Screening_Hit', 'Screening_Hit'], tm_alert_count: 0 },
      on: { transaction_status: 'IN_REVIEW', monitoring_alert_count: 1, monitoring_alert_types: ['Transaction_Rule_Hit'], tm_alert_count: 1 },
      identical: false,
    },
    notes: 'Second delivery with a new event id. OFF: another legacy alert. ON: the same TmAlert is reused (dedupe), no second alert.',
  },
  {
    name: 'transaction.status.updated APPROVED', kind: 'transaction', order: 12, setup_group: 'txn', webhook_type: 'transaction.status.updated',
    payload: TXN('transaction.status.updated', 'APPROVED'),
    expected: {
      off: { transaction_status: 'APPROVED', monitoring_alert_count: 2, monitoring_alert_types: ['Screening_Hit', 'Screening_Hit'], tm_alert_count: 0 },
      on: { transaction_status: 'APPROVED', monitoring_alert_count: 1, monitoring_alert_types: ['Transaction_Rule_Hit'], tm_alert_count: 1 },
      identical: false,
    },
    notes: 'Status moves to APPROVED; no new alerts in either mode.',
  },
  ...[1, 2].map((n) => ({
    name: n === 1 ? 'transaction.status.updated IN_REVIEW — TM on' : 'transaction.status.updated IN_REVIEW — TM on (replay, no duplicates)',
    kind: 'transaction', order: 12 + n, setup_group: 'txn-f01', webhook_type: 'transaction.status.updated',
    payload: TXN('transaction.status.updated', 'IN_REVIEW'),
    expected: {
      off: { tm_alert_count: 0 },
      on: {
        transaction_status: 'IN_REVIEW', tm_alert_count: 1, monitoring_alert_count: 1, monitoring_alert_types: ['Transaction_Rule_Hit'],
        rule_hit_linked_to_tm_alert: true, txn_webhook_audit_recorded: true, risk_recompute_evidence: true,
      },
      identical: false,
    },
    notes: n === 1
      ? 'tm_core ON: one TmAlert, one Transaction_Rule_Hit linked by tm_alert_id, a didit_transaction_webhook audit event and customer risk recompute evidence.'
      : 'Same payload delivered again: still exactly one TmAlert and one MonitoringAlert.',
  })),
  // Real-session fixtures: use tm_settings.regression_session_id / regression_outreach_ref (Demo tenant). Skipped when those are empty.
  {
    name: 'Terminal Approved — real session', kind: 'real_session', order: 40, setup_group: 'real-40', webhook_type: 'status.updated',
    payload: {},
    expected: { off: { real_result: 'pass' }, on: { real_result: 'pass' }, identical: false },
    notes: 'Sets the configured outreach item to Pending, replays a signed status.updated Approved for the real session, expects idv_status to change and a webhook AuditEvent; the item is then restored.',
  },
  {
    name: 'data.updated — real session', kind: 'real_session', order: 41, setup_group: 'real-41', webhook_type: 'data.updated',
    payload: {},
    expected: { off: { real_result: 'pass' }, on: { real_result: 'pass' }, identical: false },
    notes: 'Replays a signed data.updated for the same real session; expects an AuditEvent or an outreach update after the replay; the item is then restored.',
  },
];