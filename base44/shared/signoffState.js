// Sign-off state machine (build spec §5). Pure: given the case, route, advice and an event, returns the next state and the
// case patch, or an error. The I/O (writes, audit, notifications, side effects) lives in caseSignoffAction.
// KycCase.signoff_status: draft | with_compliance | info_needed | with_approver | approved | declined | terminated
// KycCase.status is kept in step for lists and dashboards (QC / Compliance_Review / Sign_Off_Pending / Approved / Rejected / Closed).
import { RANK } from './signoffRouting.js';

export const SIGNOFF_STATUS_LABEL = {
  draft: 'Draft', with_compliance: 'With Compliance', info_needed: 'Compliance needs information', with_approver: 'With approver',
  approved: 'Approved', declined: 'Declined, not onboarded', terminated: 'Relationship terminated',
};
export const LEGACY_STATUS = {
  draft: 'QC', with_compliance: 'Compliance_Review', info_needed: 'Compliance_Review', with_approver: 'Sign_Off_Pending',
  approved: 'Approved', declined: 'Rejected', terminated: 'Closed',
};
export const FINAL_STATES = ['approved', 'declined', 'terminated'];
const MIN_RATIONALE = 10;

const err = (message, status = 409) => ({ error: message, status });
const txt = (v) => String(v ?? '').trim();

/**
 * ev: { type, by: user, payload }. ctx: { kycCase, route, advice, perms, qcPassed }.
 * Returns { to, patch, audit: { event_type, text }, effects: [] } or { error, status }.
 */
export function transition(ctx, ev) {
  const { kycCase, route, advice, perms, qcPassed } = ctx;
  const from = kycCase.signoff_status || 'draft';
  const p = ev.payload || {};
  const now = new Date().toISOString();
  const out = (to, patch, event_type, text, effects = []) => ({ to, patch: { signoff_status: to, status: LEGACY_STATUS[to], ...patch }, audit: { event_type, text }, effects });

  switch (ev.type) {
    case 'submit': {
      if (!['draft'].includes(from)) return err(`The case cannot be submitted while it is ${from.replace('_', ' ')}`);
      if (!perms.canSubmit) return err('You do not have permission to submit this case', 403);
      if (!route?.level) return err('Finish the Risk Assessment (classification) before submitting', 422);
      if (!qcPassed) return err('QC must pass before the case can be submitted', 422);
      if (route.isDowngrade && txt(p.downgrade_motivation).length < MIN_RATIONALE) return err('A motivation for the downgrade is required (at least 10 characters)', 422);
      const base = { sign_off_submitted_by: ev.by.id, sign_off_submitted_at: now, submitted_note: txt(p.note).slice(0, 2000), downgrade_motivation: route.isDowngrade ? txt(p.downgrade_motivation).slice(0, 2000) : '', route: { ...route, computed_at: now } };
      if (route.needsAdvice) {
        const adviceValid = advice && ['received'].includes(advice.status) && advice.valid_for_key === routeKey(route);
        if (adviceValid) return out('with_approver', base, 'case.submitted', `Submitted for ${route.level} sign-off; earlier Compliance advice still valid.`, ['notify_approvers']);
        return out('with_compliance', { ...base, advice_state: 'requested' }, 'case.submitted', 'Submitted for Compliance advice.', ['advice_requested', 'notify_compliance']);
      }
      return out('with_approver', base, 'case.submitted', route.level === 'analyst' ? 'Continued to self sign-off (Low risk).' : `Submitted for ${route.level} sign-off.`, route.level === 'analyst' ? [] : ['notify_approvers']);
    }
    case 'give_advice': {
      if (!['with_compliance'].includes(from) && !(advice?.status === 'outdated' && from === 'with_approver')) return err('Advice can only be given while the case is with Compliance');
      if (!perms.canGiveAdvice) return err('Only Compliance can give advice, and not on a case they submitted', 403);
      if (!['Supportive', 'Supportive with conditions', 'Not supportive'].includes(p.outcome)) return err('Choose an outcome', 422);
      if (!['Approve', 'Decline', 'Reclassify'].includes(p.recommendation)) return err('Choose a recommendation', 422);
      if (p.recommendation === 'Approve' && route.effective === 'Unacceptable') return err('Approve is not a possible recommendation for an Unacceptable classification', 422);
      if (txt(p.advice_html).replace(/<[^>]+>/g, '').length < 20) return err('Write the advice (at least 20 characters)', 422);
      return out('with_approver', { advice_state: 'received' }, 'advice.submitted', `Compliance advice: ${p.outcome}, recommends ${p.recommendation}.`, ['advice_saved', 'report_version_with_advice', 'notify_approvers']);
    }
    case 'ask_info': {
      if (from !== 'with_compliance') return err('More information can only be requested while the case is with Compliance');
      if (!perms.canGiveAdvice) return err('Only Compliance can request more information', 403);
      if (txt(p.question).length < 10) return err('Write the question (at least 10 characters)', 422);
      return out('info_needed', { advice_state: 'info_needed' }, 'advice.info_requested', `Compliance asks: ${txt(p.question).slice(0, 300)}`, ['notify_analyst']);
    }
    case 'answer_info': {
      if (from !== 'info_needed') return err('There is no open question from Compliance');
      if (!perms.canSubmit) return err('You do not have permission to answer', 403);
      if (txt(p.answer).length < 5) return err('Write the answer', 422);
      return out('with_compliance', { advice_state: 'requested' }, 'advice.info_answered', `Analyst answered: ${txt(p.answer).slice(0, 300)}`, ['notify_compliance']);
    }
    case 'return_to_analyst': {
      if (from !== 'with_compliance') return err('Only a case with Compliance can be returned by Compliance');
      if (!perms.canGiveAdvice) return err('Only Compliance can return the case', 403);
      if (txt(p.reason).length < MIN_RATIONALE) return err('A reason is required (at least 10 characters)', 422);
      return out('draft', { advice_state: 'none', returned_reason: txt(p.reason).slice(0, 2000) }, 'advice.returned_to_analyst', `Compliance returned the case: ${txt(p.reason).slice(0, 300)}`, ['qc_reset', 'notify_analyst']);
    }
    case 'confirm_advice': {
      if (advice?.status !== 'outdated') return err('There is no outdated advice to confirm');
      if (!perms.canGiveAdvice) return err('Only Compliance can confirm the advice', 403);
      return out(from, { advice_state: 'received' }, 'advice.confirmed', 'Compliance confirmed the advice is still valid for the new classification.', ['advice_confirmed']);
    }
    case 'escalate': {
      if (from !== 'with_approver' || route.level !== 'manager') return err('Only a case waiting for Manager sign-off can be escalated');
      if (!perms.canEscalate) return err('You cannot escalate this case', 403);
      if (txt(p.reason).length < MIN_RATIONALE) return err('A reason is required (at least 10 characters)', 422);
      return out('with_approver', { route: { ...route, level: 'senior', escalated: true, reason: `${route.reason} Escalated to Senior Management.` } }, 'case.escalated', `Escalated to Senior Management: ${txt(p.reason).slice(0, 300)}`, ['notify_approvers']);
    }
    case 'approve': {
      if (from !== 'with_approver') return err('The case is not waiting for sign-off');
      if (route.effective === 'Unacceptable') return err('An Unacceptable client cannot be approved. Decline or terminate, or return to reclassify.', 422);
      if (route.needsAdvice && advice?.status !== 'received') return err(advice?.status === 'outdated' ? 'The Compliance advice is outdated. Compliance must confirm or revise it first.' : 'Compliance advice is required first', 422);
      if (!perms.canApprove) return err(perms.blockedFourEyes ? 'Four-eyes: another person must approve this case' : perms.blockedAdviser ? 'You gave the Compliance advice on this case and cannot approve it' : `This case needs ${route.level} sign-off`, 403);
      const self = route.level === 'analyst';
      if (!self && txt(p.rationale).length < MIN_RATIONALE) return err('A rationale is required (at least 10 characters)', 422);
      return out('approved', { sign_off_approved_by: ev.by.id, sign_off_approved_at: now, step_8_status: 'complete', closed_at: now, completed_at: now }, 'signoff.approved', self ? 'Approved by self sign-off (Low risk).' : `Approved: ${txt(p.rationale).slice(0, 300)}`, ['decision', 'freeze_report', 'approve_side_effects', 'notify_analyst']);
    }
    case 'return': {
      if (from !== 'with_approver') return err('The case is not waiting for sign-off');
      if (!perms.canReturn) return err('You cannot return this case', 403);
      if (txt(p.rationale).length < MIN_RATIONALE) return err('A rationale is required (at least 10 characters)', 422);
      return out('draft', { sign_off_rejection_reason: txt(p.rationale).slice(0, 2000) }, 'signoff.returned', `Returned to Draft Report & QC: ${txt(p.rationale).slice(0, 300)}`, ['decision', 'qc_reset', 'notify_analyst']);
    }
    case 'decline':
    case 'terminate': {
      if (from !== 'with_approver') return err('The case is not waiting for sign-off');
      if (route.effective !== 'Unacceptable') return err('Decline or terminate is only possible for an Unacceptable classification', 422);
      const isExisting = !!kycCase.existing_classification || kycCase.case_type !== 'Onboarding';
      if (ev.type === 'decline' && isExisting) return err('An existing client is terminated, not declined', 422);
      if (ev.type === 'terminate' && !isExisting) return err('A new client is declined, not terminated', 422);
      if (route.needsAdvice && advice?.status !== 'received') return err('Compliance advice is required first', 422);
      if (!perms.canApprove) return err('Senior Management (not the submitter or the adviser) must take this decision', 403);
      if (txt(p.rationale).length < MIN_RATIONALE) return err('A rationale is required (at least 10 characters)', 422);
      if (!['no_report_required', 'report_filed', 'report_to_be_filed'].includes(p.reporting_obligation)) return err('Record the reporting-obligation assessment', 422);
      const to = ev.type === 'decline' ? 'declined' : 'terminated';
      return out(to, { sign_off_approved_by: ev.by.id, sign_off_approved_at: now, step_8_status: 'complete', closed_at: now, completed_at: now, sign_off_rejection_reason: txt(p.rationale).slice(0, 2000) },
        `signoff.${ev.type === 'decline' ? 'declined' : 'terminated'}`, `${ev.type === 'decline' ? 'Relationship declined' : 'Relationship terminated'}: ${txt(p.rationale).slice(0, 300)}`, ['decision', 'freeze_report', 'declined_record', 'notify_analyst']);
    }
    case 'reopen': {
      if (!['approved', 'declined', 'terminated'].includes(from)) return err('Only a closed case can be reopened');
      if (!perms.canReopen) return err('Only Senior Management can reopen a case', 403);
      if (txt(p.reason).length < MIN_RATIONALE) return err('A reason is required (at least 10 characters)', 422);
      return out('draft', { step_8_status: 'not_started', closed_at: null, reopened_reason: txt(p.reason).slice(0, 2000), reopen_scope: p.scope === 'full' ? 'full' : 'partial' }, 'case.reopened', `Reopened (${p.scope === 'full' ? 'full' : 'partial'}): ${txt(p.reason).slice(0, 300)}`, ['reopen_steps', 'qc_reset']);
    }
    default:
      return err(`Unknown action ${ev.type}`, 400);
  }
}

/** Key the advice is valid for: existing|proposed classification at the time of advice (spec §4 outdated rule). */
export const routeKey = (route) => `${route?.existing || 'New'}|${route?.proposed || ''}`;

/** After a classification change: does the advice become outdated? */
export function adviceOutdated(advice, route) {
  return !!advice && ['received'].includes(advice.status) && !!advice.valid_for_key && advice.valid_for_key !== routeKey(route) && route.needsAdvice;
}

export const higher = (a, b) => (RANK[a] || 0) >= (RANK[b] || 0) ? a : b;
