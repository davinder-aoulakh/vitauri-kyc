// Inputs captured on a Decision at the moment it is taken, so the decision can be reproduced later
// even after the alert, case, profile or risk score has changed.
import { asList } from './tmAuth.js';

/** Latest dynamic risk score of the client: { score, band, computed_at } or null. */
export async function riskAt(E, tenantId, clientId) {
  if (!clientId) return null;
  const s = asList(await E.CustomerRiskScore.filter({ tenant_id: tenantId, client_id: clientId }, '-computed_at', 1))[0];
  return s ? { score: s.score ?? null, band: s.band || null, computed_at: s.computed_at || null } : null;
}

/** The alert as the decision-maker saw it. */
export function alertInputs(a) {
  return {
    ref: a.ref || null, title: a.title || null, score: a.score ?? null, priority: a.priority || null,
    scenario_id: a.scenario_id || null, indicator_type: a.indicator_type || null, status_before: a.status,
    transaction_ids: (a.transaction_ids || []).slice(0, 200),
    ai_proposal: a.ai_proposal || null, ai_insufficient_evidence: !!a.ai_insufficient_evidence,
    due_at: a.due_at || null, intended_at: a.intended_at || null, executed_at: a.executed_at || null,
  };
}

/** A TM case and its alerts as they stood at the decision. */
export async function caseInputs(E, tenantId, tmCase) {
  const ids = tmCase.alert_ids || [];
  const alerts = ids.length ? asList(await E.TmAlert.filter({ tenant_id: tenantId, id: { $in: ids } }, undefined, 200)) : [];
  return {
    case_ref: tmCase.case_ref || null, status_before: tmCase.status, co_decision: tmCase.co_decision || null,
    client_ids: tmCase.client_ids || [], network_client_ids: tmCase.network_client_ids || [],
    alerts: alerts.map((a) => ({ id: a.id, ref: a.ref || null, status: a.status, score: a.score ?? null, scenario_id: a.scenario_id || null })),
  };
}
