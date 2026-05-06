import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { AlertTriangle, CheckCircle, Clock, FileText, Loader2, X } from 'lucide-react';
import { canApproveRisk } from '@/lib/permissions';
import { RISK_COLORS } from '@/lib/riskColors';
import { cn } from '@/lib/utils';
import { format } from 'date-fns';

export default function SignOffStep({ kycCase, client, currentUser, onCaseUpdate }) {
  const [approvalNote, setApprovalNote] = useState('');
  const [rejectionReason, setRejectionReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [action, setAction] = useState(null);

  const userRole = currentUser?.app_role;
  const risk = kycCase?.risk_classification;
  const canApprove = canApproveRisk(userRole, risk);
  const isAnalyst = userRole === 'Analyst';
  const isPending = kycCase?.status === 'Sign_Off_Pending';
  const isApproved = kycCase?.status === 'Approved';

  const requiredApprover = !risk || risk === 'Low' ? 'Analyst (self-sign-off)' :
    risk === 'Medium' ? 'Manager' : 'Director / Senior Management';

  async function submitForSignOff() {
    setSubmitting(true);
    await base44.entities.KycCase.update(kycCase.id, {
      status: 'Sign_Off_Pending',
      sign_off_submitted_by: currentUser?.id,
      sign_off_submitted_at: new Date().toISOString(),
      step_8_status: 'in_progress',
    });
    await base44.entities.AuditEvent.create({
      tenant_id: kycCase.tenant_id,
      case_id: kycCase.id,
      actor_user_id: currentUser?.id,
      actor_name: currentUser?.full_name,
      actor_type: 'User',
      event_type: 'sign_off_submitted',
      notes: `Submitted for ${requiredApprover} approval`,
    });
    onCaseUpdate?.(prev => ({ ...prev, status: 'Sign_Off_Pending', step_8_status: 'in_progress' }));
    setSubmitting(false);
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
      tenant_id: kycCase.tenant_id,
      case_id: kycCase.id,
      actor_user_id: currentUser?.id,
      actor_name: currentUser?.full_name,
      actor_type: 'User',
      event_type: 'sign_off_approved',
      notes: approvalNote,
    });
    onCaseUpdate?.(prev => ({ ...prev, status: 'Approved', step_8_status: 'complete' }));
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
      tenant_id: kycCase.tenant_id,
      case_id: kycCase.id,
      actor_user_id: currentUser?.id,
      actor_name: currentUser?.full_name,
      actor_type: 'User',
      event_type: 'sign_off_rejected',
      notes: rejectionReason,
    });
    onCaseUpdate?.(prev => ({ ...prev, status: 'In_Progress' }));
    setAction(null);
    setSubmitting(false);
  }

  return (
    <div className="space-y-5">
      {/* Risk Banner */}
      {risk && (
        <div className={cn('rounded-xl border-2 p-4 flex items-center gap-3', RISK_COLORS[risk]?.border, RISK_COLORS[risk]?.bg)}>
          <AlertTriangle className={cn('w-5 h-5 flex-shrink-0', RISK_COLORS[risk]?.text)} />
          <div>
            <span className={cn('font-semibold text-sm', RISK_COLORS[risk]?.text)}>
              {risk} Risk case
            </span>
            <span className="text-xs text-muted-foreground ml-2">— {requiredApprover} approval required</span>
          </div>
        </div>
      )}

      {/* Case Summary */}
      <div className="bg-card border border-border rounded-xl p-4">
        <h3 className="font-semibold text-sm mb-3">Case Summary for Approver</h3>
        <div className="grid grid-cols-2 gap-3 text-xs">
          {[
            { label: 'Client', value: client?.full_name },
            { label: 'Case Type', value: kycCase?.case_type?.replace(/_/g,' ') },
            { label: 'Risk Classification', value: risk || '—' },
            { label: 'Assigned Analyst', value: currentUser?.full_name },
          ].map(f => (
            <div key={f.label} className="flex justify-between py-2 border-b border-border/50">
              <span className="text-muted-foreground">{f.label}</span>
              <span className="font-medium">{f.value || '—'}</span>
            </div>
          ))}
        </div>

        <div className="mt-3">
          <Button variant="outline" size="sm" className="gap-1.5 text-xs">
            <FileText className="w-3.5 h-3.5" />
            Preview KYC Report
          </Button>
        </div>
      </div>

      {/* Sign-Off Timeline */}
      <div className="bg-card border border-border rounded-xl p-4 space-y-3">
        <h3 className="font-semibold text-sm">Sign-Off Workflow</h3>

        <div className="flex items-start gap-3">
          <CheckCircle className="w-4 h-4 text-emerald-500 mt-0.5 flex-shrink-0" />
          <div>
            <div className="text-xs font-medium">Analyst — Submitted for Sign-Off</div>
            {kycCase?.sign_off_submitted_at ? (
              <div className="text-xs text-muted-foreground">
                {format(new Date(kycCase.sign_off_submitted_at), 'd MMM yyyy HH:mm')}
              </div>
            ) : (
              <div className="text-xs text-muted-foreground">Not yet submitted</div>
            )}
          </div>
        </div>

        <div className="flex items-start gap-3">
          {isApproved ? (
            <CheckCircle className="w-4 h-4 text-emerald-500 mt-0.5 flex-shrink-0" />
          ) : isPending ? (
            <Clock className="w-4 h-4 text-amber-500 mt-0.5 flex-shrink-0" />
          ) : (
            <div className="w-4 h-4 rounded-full border-2 border-muted-foreground/30 mt-0.5 flex-shrink-0" />
          )}
          <div>
            <div className="text-xs font-medium">{requiredApprover} — {isApproved ? 'Approved' : isPending ? 'Pending' : 'Waiting'}</div>
            {kycCase?.sign_off_approved_at && (
              <div className="text-xs text-muted-foreground">
                {format(new Date(kycCase.sign_off_approved_at), 'd MMM yyyy HH:mm')}
              </div>
            )}
          </div>
        </div>

        {kycCase?.sign_off_rejection_reason && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-xs text-red-700">
            <strong>Rejected:</strong> {kycCase.sign_off_rejection_reason}
          </div>
        )}
      </div>

      {/* Actions */}
      {!isPending && !isApproved && isAnalyst && (
        <Button onClick={submitForSignOff} disabled={submitting} className="w-full gap-2">
          {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle className="w-4 h-4" />}
          Submit for Sign-Off
        </Button>
      )}

      {isPending && canApprove && !isApproved && (
        <div className="space-y-3">
          <Textarea
            value={approvalNote}
            onChange={e => setApprovalNote(e.target.value)}
            placeholder="Optional approval note…"
            className="text-sm min-h-16"
          />
          <div className="flex gap-3">
            <Button
              className="flex-1 gap-2 bg-emerald-600 hover:bg-emerald-700 text-white"
              onClick={approve}
              disabled={submitting}
            >
              <CheckCircle className="w-4 h-4" />
              Approve & Generate Report
            </Button>
            <Button
              variant="outline"
              className="flex-1 gap-2 border-red-300 text-red-600 hover:bg-red-50"
              onClick={() => setAction('reject')}
            >
              <X className="w-4 h-4" />
              Reject
            </Button>
          </div>

          {action === 'reject' && (
            <div className="bg-red-50 border border-red-200 rounded-xl p-4 space-y-3">
              <div className="text-sm font-semibold text-red-800">Rejection Reason</div>
              <Textarea
                value={rejectionReason}
                onChange={e => setRejectionReason(e.target.value)}
                placeholder="Please provide the reason for rejection…"
                className="text-sm min-h-16"
              />
              <Button
                className="w-full bg-red-600 hover:bg-red-700 text-white"
                onClick={reject}
                disabled={submitting || !rejectionReason.trim()}
              >
                Confirm Rejection
              </Button>
            </div>
          )}
        </div>
      )}

      {isApproved && (
        <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4 flex items-center gap-3">
          <CheckCircle className="w-5 h-5 text-emerald-600" />
          <div>
            <div className="text-sm font-semibold text-emerald-800">Case Approved</div>
            <div className="text-xs text-emerald-600">KYC report generated · Monitoring activated</div>
          </div>
        </div>
      )}
    </div>
  );
}