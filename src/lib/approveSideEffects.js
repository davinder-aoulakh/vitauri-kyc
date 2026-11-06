// Side effects of a KYC sign-off decision, extracted unchanged from SignOffStep.approve()/reject():
// TM decision log + EDR outcome sync, and the expected profile (propose, and approve when this approver has the authority).
// They never block or undo the sign-off; failures show a toast.
import { base44 } from '@/api/base44Client';
import { isFeatureEnabled } from '@/lib/featureFlags';
import { canDecideProfile } from '@/lib/profileApproval';
import { toast } from '@/components/ui/use-toast';

export async function recordTmDecision({ kycCase, tenant, outcome, amlAssessment }) {
  if (!isFeatureEnabled(tenant, 'tm_core')) return;
  try {
    const hasTmContext = !!kycCase.tm_case_id || (kycCase.tm_alert_ids || []).length > 0 || !!kycCase.tm_context?.trigger;
    const showAml = kycCase.case_type === 'Event_Driven_Review' && hasTmContext && amlAssessment?.outcome;
    const res = await base44.functions.invoke('recordKycDecision', { kyc_case_id: kycCase.id, outcome, ...(showAml ? { aml_assessment: amlAssessment } : {}) });
    if (res?.data?.error) throw new Error(res.data.error);
    if (kycCase.tm_case_id) {
      const sync = await base44.functions.invoke('syncEdrOutcome', { kyc_case_id: kycCase.id });
      if (sync?.data?.error) throw new Error(sync.data.error);
    }
  } catch (e) {
    console.warn('recordKycDecision/syncEdrOutcome failed (sign-off unaffected):', e?.message);
    toast({ title: 'Decision log could not be written — sign-off saved' });
  }
}

export async function proposeProfileAfterApproval({ kycCase, client, tenant, currentUser, note }) {
  try {
    if (!isFeatureEnabled(tenant, 'tm_core')) return;
    const res = await base44.functions.invoke('proposeExpectedProfile', { client_id: kycCase.client_id, case_id: kycCase.id, source: 'kyc_case' });
    const profile = res?.data?.profile;
    const mayApprove = profile?.id && profile.status === 'proposed' && canDecideProfile({
      role: currentUser?.app_role, userId: currentUser?.id, tenant,
      riskClass: client?.risk_classification || kycCase.risk_classification, proposedBy: profile.proposed_by_user_id,
    });
    if (mayApprove) {
      const ap = await base44.functions.invoke('approveExpectedProfile', {
        profile_id: profile.id, decision: 'approve',
        rationale: profile.rationale || `Approved with KYC sign-off of ${String(kycCase.case_type || 'case').replace(/_/g, ' ')}${note ? `: ${note}` : ''}`,
      });
      if (ap?.data?.error) throw new Error(ap.data.error);
    } else if (profile?.id) {
      toast({ title: `Expected profile v${profile.version} proposed`, description: 'It waits in My work for an approver with the right authority.' });
    }
  } catch (e) {
    console.warn('expected profile propose/approve failed (sign-off unaffected):', e?.message);
    toast({ title: 'Sign-off saved; the expected profile still needs approval', description: e?.response?.data?.error || e?.message });
  }
}

/** Everything the old approve() did after the case update. */
export async function afterApproval(args) {
  await proposeProfileAfterApproval(args);
  await recordTmDecision({ ...args, outcome: 'approved' });
}
