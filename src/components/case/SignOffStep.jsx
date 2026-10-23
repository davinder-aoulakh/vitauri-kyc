import React, { useState, useEffect } from 'react';
import { useAutoSave } from '@/hooks/useAutoSave';
import AutoSaveIndicator from '@/components/shared/AutoSaveIndicator';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { AlertTriangle, CheckCircle, Clock, FileText, Loader2, X, MessageSquare, RefreshCw } from 'lucide-react';
import { canApproveRisk } from '@/lib/permissions';
import { RISK_COLORS } from '@/lib/riskColors';
import { cn } from '@/lib/utils';
import { format } from 'date-fns';
import { useTenant } from '@/lib/tenantContext';
import { isFeatureEnabled } from '@/lib/featureFlags';
import { toast } from '@/components/ui/use-toast';
import SignOffTmOutcome from '@/components/case/SignOffTmOutcome';
import SignOffProfilePanel from '@/components/case/tm/SignOffProfilePanel';
import { canDecideProfile } from '@/lib/profileApproval';

const SIGN_OFF_MATRIX = {
  Low:          'Analyst (self-sign-off)',
  Medium:       'Manager approval required',
  High:         'Director / Senior Management approval required',
  Unacceptable: 'Director / Senior Management approval required + Compliance Advisory',
};

const COMPLIANCE_RISKS = ['Medium', 'High', 'Unacceptable'];

export default function SignOffStep({ kycCase, client, currentUser, onCaseUpdate, onRefresh, refreshing }) {
  const { tenant } = useTenant();
  const [approvalNote, setApprovalNote]       = useState('');
  const [rejectionReason, setRejectionReason] = useState('');
  const [advisoryNote, setAdvisoryNote]       = useState(kycCase?.compliance_advisory_note || '');
  const [advisorySaved, setAdvisorySaved]     = useState(false);
  const [submitting, setSubmitting]           = useState(false);
  const [action, setAction]                   = useState(null); // 'reject' | 'advisory'
  const [users, setUsers]                     = useState([]);
  const [amlAssessment, setAmlAssessment]     = useState(null); // TM: optional AML assessment for EDR cases

  // Auto-save advisory note for Compliance Officers
  const { autoSaving: advisoryAutoSaving, lastSaved: advisoryLastSaved } = useAutoSave(
    advisoryNote,
    async (note) => {
      if (!kycCase?.id || !note?.trim()) return;
      await base44.entities.KycCase.update(kycCase.id, { compliance_advisory_note: note });
      onCaseUpdate?.(prev => ({ ...prev, compliance_advisory_note: note }));
    },
    1500,
  );

  const userRole   = currentUser?.app_role;
  const risk       = kycCase?.risk_classification;
  const canApprove = canApproveRisk(userRole, risk);
  const isAnalyst  = userRole === 'Analyst';
  const isCompliance = userRole === 'Compliance Officer';
  const isPending  = kycCase?.status === 'Sign_Off_Pending';
  const isApproved = kycCase?.status === 'Approved';
  const requiredApprover = SIGN_OFF_MATRIX[risk] || 'Analyst (self-sign-off)';

  useEffect(() => {
    base44.entities.User.list().then(u => setUsers(u || [])).catch(() => setUsers([]));
  }, []);

  const submittedByUser = users.find(u => u.id === kycCase?.sign_off_submitted_by);
  const approvedByUser  = users.find(u => u.id === kycCase?.sign_off_approved_by);

  async function submitForSignOff() {
    setSubmitting(true);
    await base44.entities.KycCase.update(kycCase.id, {
      status: 'Sign_Off_Pending',
      sign_off_submitted_by: currentUser?.id,
      sign_off_submitted_at: new Date().toISOString(),
      step_8_status: 'in_progress',
    });
    await base44.entities.AuditEvent.create({
      tenant_id: kycCase.tenant_id, case_id: kycCase.id,
      actor_user_id: currentUser?.id, actor_name: currentUser?.full_name,
      actor_type: 'User', event_type: 'sign_off_submitted',
      notes: `Submitted for ${requiredApprover}`,
    });
    // Notify managers/directors
    const approverRoles = risk === 'Medium' ? ['Manager','Director'] : ['Director'];
    const approvers = users.filter(u => approverRoles.includes(u.app_role));
    await Promise.all(approvers.map(u =>
      base44.entities.Notification.create({
        tenant_id: kycCase.tenant_id, user_id: u.id,
        type: 'sign_off_request',
        title: 'Sign-Off Requested',
        body: `Case for ${client?.full_name || 'a client'} (${risk} risk) requires your approval.`,
        link_case_id: kycCase.id,
      })
    ));
    onCaseUpdate?.(prev => ({ ...prev, status: 'Sign_Off_Pending', step_8_status: 'in_progress' }));
    setSubmitting(false);
  }

  // TM: record the sign-off as a Decision and sync EDR outcome to the TM case. Never blocks or undoes sign-off.
  async function recordTmDecision(outcome) {
    if (!isFeatureEnabled(tenant, 'tm_core')) return;
    try {
      const hasTmContext = !!kycCase.tm_case_id || (kycCase.tm_alert_ids || []).length > 0 || !!kycCase.tm_context?.trigger;
      const showAml = kycCase.case_type === 'Event_Driven_Review' && hasTmContext && amlAssessment?.outcome;
      const res = await base44.functions.invoke('recordKycDecision', {
        kyc_case_id: kycCase.id, outcome, ...(showAml ? { aml_assessment: amlAssessment } : {}),
      });
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

  async function approve() {
    setSubmitting(true);
    await base44.entities.KycCase.update(kycCase.id, {
      status: 'Approved',
      sign_off_approved_by: currentUser?.id,
      sign_off_approved_at: new Date().toISOString(),
      step_8_status: 'complete',
    });
    await base44.entities.AuditEvent.create({
      tenant_id: kycCase.tenant_id, case_id: kycCase.id,
      actor_user_id: currentUser?.id, actor_name: currentUser?.full_name,
      actor_type: 'User', event_type: 'sign_off_approved',
      notes: approvalNote || 'Approved',
    });
    // Notify analyst
    if (kycCase.sign_off_submitted_by) {
      await base44.entities.Notification.create({
        tenant_id: kycCase.tenant_id, user_id: kycCase.sign_off_submitted_by,
        type: 'sign_off_decision',
        title: 'Case Approved',
        body: `Your case for ${client?.full_name || 'a client'} has been approved.`,
        link_case_id: kycCase.id,
      });
    }
    onCaseUpdate?.(prev => ({ ...prev, status: 'Approved', step_8_status: 'complete' }));
    // TM: propose the expected profile (the step 4 draft when there is one) once sign-off is saved, and approve it
    // in the same motion when this approver has the authority. Never blocks sign-off.
    try {
      if (isFeatureEnabled(tenant, 'tm_core')) {
        const res = await base44.functions.invoke('proposeExpectedProfile', {
          client_id: kycCase.client_id, case_id: kycCase.id, source: 'kyc_case',
        });
        const profile = res?.data?.profile;
        const mayApprove = profile?.id && profile.status === 'proposed' && canDecideProfile({
          role: currentUser?.app_role, userId: currentUser?.id, tenant,
          riskClass: client?.risk_classification || kycCase.risk_classification, proposedBy: profile.proposed_by_user_id,
        });
        if (mayApprove) {
          const ap = await base44.functions.invoke('approveExpectedProfile', {
            profile_id: profile.id, decision: 'approve',
            rationale: profile.rationale || `Approved with KYC sign-off of ${String(kycCase.case_type || 'case').replace(/_/g, ' ')}${approvalNote ? `: ${approvalNote}` : ''}`,
          });
          if (ap?.data?.error) throw new Error(ap.data.error);
        } else if (profile?.id) {
          toast({ title: `Expected profile v${profile.version} proposed`, description: 'It waits in My work for an approver with the right authority.' });
        }
      }
    } catch (e) {
      console.warn('expected profile propose/approve failed (sign-off unaffected):', e?.message);
      toast({ title: 'Sign-off saved; the expected profile still needs approval', description: e?.response?.data?.error || e?.message });
    }
    await recordTmDecision('approved');
    setAction(null);
    setSubmitting(false);
  }

  async function reject() {
    if (!rejectionReason.trim()) return;
    setSubmitting(true);
    await base44.entities.KycCase.update(kycCase.id, {
      status: 'In_Progress',
      sign_off_rejection_reason: rejectionReason,
    });
    await base44.entities.AuditEvent.create({
      tenant_id: kycCase.tenant_id, case_id: kycCase.id,
      actor_user_id: currentUser?.id, actor_name: currentUser?.full_name,
      actor_type: 'User', event_type: 'sign_off_rejected',
      notes: rejectionReason,
    });
    // Notify analyst
    if (kycCase.sign_off_submitted_by) {
      await base44.entities.Notification.create({
        tenant_id: kycCase.tenant_id, user_id: kycCase.sign_off_submitted_by,
        type: 'sign_off_decision',
        title: 'Case Returned for Revision',
        body: `Your case for ${client?.full_name || 'a client'} was rejected: ${rejectionReason}`,
        link_case_id: kycCase.id,
      });
    }
    onCaseUpdate?.(prev => ({ ...prev, status: 'In_Progress' }));
    await recordTmDecision('rejected');
    setAction(null);
    setSubmitting(false);
  }

  async function saveAdvisoryNote() {
    await base44.entities.KycCase.update(kycCase.id, { compliance_advisory_note: advisoryNote });
    await base44.entities.AuditEvent.create({
      tenant_id: kycCase.tenant_id, case_id: kycCase.id,
      actor_user_id: currentUser?.id, actor_name: currentUser?.full_name,
      actor_type: 'User', event_type: 'compliance_advisory_note_added',
      notes: advisoryNote,
    });
    setAdvisorySaved(true);
    setTimeout(() => setAdvisorySaved(false), 2000);
    onCaseUpdate?.(prev => ({ ...prev, compliance_advisory_note: advisoryNote }));
  }

  return (
    <div className="space-y-5">

      {/* Risk Banner */}
      {risk && (
        <div className={cn('rounded-xl border-2 p-4 flex items-center gap-3', RISK_COLORS[risk]?.border, RISK_COLORS[risk]?.bg)}>
          <AlertTriangle className={cn('w-5 h-5 flex-shrink-0', RISK_COLORS[risk]?.text)} />
          <div>
            <span className={cn('font-semibold text-sm', RISK_COLORS[risk]?.text)}>{risk} Risk</span>
            <span className="text-xs text-muted-foreground ml-2">— {requiredApprover}</span>
          </div>
        </div>
      )}

      {/* Rejection banner visible to analyst */}
      {kycCase?.sign_off_rejection_reason && kycCase?.status === 'In_Progress' && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 space-y-1">
          <div className="flex items-center gap-2 text-red-800 font-semibold text-sm">
            <X className="w-4 h-4" /> Case Returned for Revision
          </div>
          <p className="text-xs text-red-700">{kycCase.sign_off_rejection_reason}</p>
        </div>
      )}

      {/* Case Summary */}
      <div className="bg-card border border-border rounded-xl p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-sm">Case Summary for Approver</h3>
          {onRefresh && (
            <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-muted-foreground" onClick={() => onRefresh(true)} title="Refresh case data">
              <RefreshCw className={cn('w-3.5 h-3.5', refreshing && 'animate-spin')} />
            </Button>
          )}
        </div>
        <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-xs">
          {[
            { label: 'Client',              value: client?.full_name },
            { label: 'Client Type',         value: client?.client_type },
            { label: 'Case Type',           value: kycCase?.case_type?.replace(/_/g,' ') },
            { label: 'Risk Classification', value: risk || '—' },
            { label: 'Submitted By',        value: submittedByUser?.full_name || currentUser?.full_name },
            { label: 'Due Date',            value: kycCase?.due_date ? format(new Date(kycCase.due_date), 'd MMM yyyy') : '—' },
          ].map(f => (
            <div key={f.label} className="flex justify-between py-1.5 border-b border-border/50">
              <span className="text-muted-foreground">{f.label}</span>
              <span className="font-medium">{f.value || '—'}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Compliance Advisory Note — Compliance Officer can add at any time */}
      {COMPLIANCE_RISKS.includes(risk) && (isCompliance || kycCase?.compliance_advisory_note) && (
        <div className="bg-violet-50 border border-violet-200 rounded-xl p-4 space-y-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-violet-800 font-semibold text-xs">
              <MessageSquare className="w-3.5 h-3.5" /> Compliance Advisory Note
            </div>
            {advisorySaved && <span className="text-xs text-emerald-600">✓ Saved</span>}
          </div>
          {isCompliance ? (
            <>
              <Textarea
                value={advisoryNote}
                onChange={e => { setAdvisoryNote(e.target.value); setAdvisorySaved(false); }}
                placeholder="Add compliance advisory note visible during sign-off and in the final report…"
                className="text-sm min-h-16 resize-none bg-white/60"
              />
              <div className="flex items-center gap-3">
                <Button size="sm" variant="outline" className="text-xs" onClick={saveAdvisoryNote} disabled={!advisoryNote.trim()}>
                  Save Advisory Note
                </Button>
                <AutoSaveIndicator autoSaving={advisoryAutoSaving} lastSaved={advisoryLastSaved} />
              </div>
            </>
          ) : (
            <p className="text-xs text-violet-900 leading-relaxed">{kycCase.compliance_advisory_note}</p>
          )}
        </div>
      )}

      {/* Sign-Off Workflow Timeline */}
      <div className="bg-card border border-border rounded-xl p-4 space-y-4">
        <h3 className="font-semibold text-sm">Sign-Off Workflow</h3>

        {/* Step 1 */}
        <div className="flex items-start gap-3">
          <div className={cn('w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5',
            kycCase?.sign_off_submitted_at ? 'bg-emerald-100' : 'bg-muted')}>
            {kycCase?.sign_off_submitted_at
              ? <CheckCircle className="w-3.5 h-3.5 text-emerald-600" />
              : <span className="text-xs text-muted-foreground font-bold">1</span>
            }
          </div>
          <div>
            <div className="text-xs font-semibold">Analyst Submission</div>
            <div className="text-xs text-muted-foreground">
              {kycCase?.sign_off_submitted_at
                ? `Submitted ${format(new Date(kycCase.sign_off_submitted_at), 'd MMM yyyy HH:mm')} by ${submittedByUser?.full_name || '—'}`
                : 'Not yet submitted'
              }
            </div>
          </div>
        </div>

        <div className="ml-3 w-px h-4 bg-border" />

        {/* Step 2 */}
        <div className="flex items-start gap-3">
          <div className={cn('w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5',
            isApproved ? 'bg-emerald-100' : isPending ? 'bg-amber-100' : 'bg-muted')}>
            {isApproved
              ? <CheckCircle className="w-3.5 h-3.5 text-emerald-600" />
              : isPending
                ? <Clock className="w-3.5 h-3.5 text-amber-600" />
                : <span className="text-xs text-muted-foreground font-bold">2</span>
            }
          </div>
          <div>
            <div className="text-xs font-semibold">
              {isApproved ? 'Approved' : isPending ? 'Awaiting Approval' : requiredApprover}
            </div>
            <div className="text-xs text-muted-foreground">
              {isApproved && kycCase?.sign_off_approved_at
                ? `Approved ${format(new Date(kycCase.sign_off_approved_at), 'd MMM yyyy HH:mm')} by ${approvedByUser?.full_name || '—'}`
                : isPending ? 'Pending approver review'
                : 'Waiting for submission'
              }
            </div>
          </div>
        </div>
      </div>

      {/* Analyst: Submit action */}
      {!isPending && !isApproved && isAnalyst && (
        <Button onClick={submitForSignOff} disabled={submitting} className="w-full gap-2">
          {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle className="w-4 h-4" />}
          Submit for Sign-Off
        </Button>
      )}

      {/* Approver: Approve / Reject */}
      {isPending && canApprove && !isApproved && (
        <div className="space-y-3">
          <Textarea
            value={approvalNote}
            onChange={e => setApprovalNote(e.target.value)}
            placeholder="Optional approval comment…"
            className="text-sm min-h-16 resize-none"
          />
          <SignOffProfilePanel kycCase={kycCase} client={client} currentUser={currentUser} />
          <SignOffTmOutcome kycCase={kycCase} value={amlAssessment} onChange={setAmlAssessment} />
          <div className="flex gap-3">
            <Button className="flex-1 gap-2 bg-emerald-600 hover:bg-emerald-700 text-white" onClick={approve} disabled={submitting}>
              {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle className="w-4 h-4" />}
              Approve &amp; Generate Report
            </Button>
            <Button variant="outline" className="flex-1 gap-2 border-red-300 text-red-600 hover:bg-red-50" onClick={() => setAction('reject')}>
              <X className="w-4 h-4" /> Reject
            </Button>
          </div>

          {action === 'reject' && (
            <div className="bg-red-50 border border-red-200 rounded-xl p-4 space-y-3">
              <div className="text-sm font-semibold text-red-800">Rejection Reason *</div>
              <Textarea
                value={rejectionReason}
                onChange={e => setRejectionReason(e.target.value)}
                placeholder="Reason for rejection — this will be visible to the analyst…"
                className="text-sm min-h-16 resize-none"
              />
              <div className="flex gap-2 justify-end">
                <Button variant="outline" size="sm" onClick={() => setAction(null)}>Cancel</Button>
                <Button className="bg-red-600 hover:bg-red-700 text-white text-xs" onClick={reject} disabled={submitting || !rejectionReason.trim()}>
                  Confirm Rejection
                </Button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Approved state */}
      {isApproved && (
        <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4 flex items-center gap-3">
          <CheckCircle className="w-5 h-5 text-emerald-600 flex-shrink-0" />
          <div>
            <div className="text-sm font-semibold text-emerald-800">Case Approved</div>
            <div className="text-xs text-emerald-600">
              Approved by {approvedByUser?.full_name || '—'} on{' '}
              {kycCase?.sign_off_approved_at ? format(new Date(kycCase.sign_off_approved_at), 'd MMM yyyy HH:mm') : '—'}
            </div>
            {approvalNote && <div className="text-xs text-emerald-700 mt-1 italic">"{approvalNote}"</div>}
          </div>
        </div>
      )}
    </div>
  );
}