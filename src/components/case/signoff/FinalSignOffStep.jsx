import React, { useMemo, useState } from 'react';
import { useTenant } from '@/lib/tenantContext';
import { useSignoff } from '@/hooks/useSignoff';
import { useTenantUsers } from '@/hooks/useTenantData';
import { afterApproval, recordTmDecision } from '@/lib/approveSideEffects';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { format, differenceInDays } from 'date-fns';
import { AlertTriangle, ArrowUpRight, CheckCircle, Loader2, RotateCcw, ShieldCheck, Ban, XCircle, Undo2 } from 'lucide-react';
import KycReportStep from '@/components/case/KycReportStep';
import ReportPreviewPanel from '@/components/case/signoff/ReportPreviewPanel';
import RationaleDialog from '@/components/case/signoff/RationaleDialog';
import SignOffTmOutcome from '@/components/case/SignOffTmOutcome';
import SignOffProfilePanel from '@/components/case/tm/SignOffProfilePanel';
import { RouteLine, Locked, reportContext, LEVEL_TEXT, ClassChip } from '@/components/case/signoff/SignoffBits';

const SEAL = {
  approved: ['FINAL · APPROVED', 'border-emerald-300 bg-emerald-50 text-emerald-900'],
  declined: ['DECLINED · NOT ONBOARDED', 'border-red-300 bg-red-50 text-red-900'],
  terminated: ['RELATIONSHIP TERMINATED', 'border-red-300 bg-red-50 text-red-900'],
};

/** Step "Final Report & Sign-off" (spec §6.4). */
export default function FinalSignOffStep({ kycCase, client, currentUser, onCaseUpdate, onNavigateToStep }) {
  const { tenant } = useTenant();
  const { info, route, perms, advice, decisions, reports, busy, act, reload } = useSignoff(kycCase, onCaseUpdate);
  const { data: users = [] } = useTenantUsers(currentUser?.tenant_id);
  const [dlg, setDlg] = useState('');
  const [preview, setPreview] = useState(null);
  const [amlAssessment, setAmlAssessment] = useState(null);
  const [freezing, setFreezing] = useState(false);
  const ctx = useMemo(() => reportContext({ kycCase, route, advice, decisions, users }), [kycCase, route, advice, decisions, users]);

  if (!info) return <div className="flex justify-center py-10"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>;
  const status = kycCase.signoff_status || 'draft';
  const decided = ['approved', 'declined', 'terminated'].includes(status);
  const nameOf = (id) => users.find((u) => u.id === id)?.full_name || '—';
  const finalDecision = decisions.find((d) => ['Approved', 'Declined', 'Terminated'].includes(d.kind));
  const frozen = reports.find((r) => r.frozen_at && ['Final', 'Declined', 'Terminated'].includes(r.status));
  const latest = reports.find((r) => r.status !== 'Superseded') || reports[0] || null;
  const reportReflectsAdvice = !route?.needsAdvice || (latest && advice?.given_at && latest.generated_at && new Date(latest.generated_at) >= new Date(advice.confirmed_at || advice.given_at));

  if (!decided && status !== 'with_approver') {
    return (
      <div className="space-y-4">
        <RouteLine route={route} />
        <Locked>
          {status === 'draft' ? 'Final Report & Sign-off opens when the case has been submitted in Draft Report & QC.'
            : 'The case is with Compliance. Sign-off opens when the Compliance advice has been given.'}
        </Locked>
      </div>
    );
  }

  const isUnacceptable = route?.effective === 'Unacceptable';
  const isExisting = !!kycCase.existing_classification || kycCase.case_type !== 'Onboarding';
  const adviceOutdated = advice?.status === 'outdated';
  const selfSignOff = route?.level === 'analyst';
  const canDecide = perms.canApprove && !adviceOutdated;

  const run = async (action, payload, okText) => {
    const res = await act(action, payload, okText);
    if (!res) return false;
    if (action === 'approve') await afterApproval({ kycCase, client, tenant, currentUser, note: payload.rationale, amlAssessment });
    if (['return', 'decline', 'terminate'].includes(action)) await recordTmDecision({ kycCase, tenant, outcome: 'rejected', amlAssessment });
    if (action === 'return') onNavigateToStep?.(10);
    return true;
  };
  const freeze = async (report) => {
    setFreezing(true);
    await act('freeze_report', { report_id: report.id }, 'Final report frozen');
    setFreezing(false);
  };
  const cycle = kycCase.created_date && (kycCase.closed_at || kycCase.sign_off_approved_at)
    ? differenceInDays(new Date(kycCase.closed_at || kycCase.sign_off_approved_at), new Date(kycCase.created_date)) : null;

  return (
    <div className="space-y-5">
      <RouteLine route={route} />

      {/* Status card */}
      <section className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-card p-4">
        <ClassChip existing={route?.existing} proposed={route?.proposed} />
        <span className="text-sm font-semibold">
          {decided ? SEAL[status][0] : `With ${LEVEL_TEXT[route?.level]}`}
        </span>
        {decided && <span className="text-xs text-muted-foreground">Closed {kycCase.closed_at ? format(new Date(kycCase.closed_at), 'd MMM yyyy') : ''}{cycle != null ? ` · cycle time ${cycle}d` : ''}</span>}
        {!decided && kycCase.sign_off_submitted_at && <span className="text-xs text-muted-foreground">Submitted {format(new Date(kycCase.sign_off_submitted_at), 'd MMM yyyy HH:mm')} by {nameOf(kycCase.sign_off_submitted_by)}</span>}
      </section>

      {/* Decision card */}
      {!decided && (
        <section className="space-y-3 rounded-xl border-2 border-primary/30 bg-card p-4">
          <div className="text-sm font-semibold">Decision</div>
          {route?.needsAdvice && advice && (
            <div className={cn('flex items-start gap-2 rounded-md px-3 py-2 text-xs', advice.outcome === 'Not supportive' || adviceOutdated ? 'bg-red-50 text-red-900' : 'bg-violet-50 text-violet-900')}>
              {(advice.outcome === 'Not supportive' || adviceOutdated) && <AlertTriangle className="h-4 w-4 flex-shrink-0" />}
              <span>
                {adviceOutdated ? 'The Compliance advice is outdated: Compliance must confirm or revise it before sign-off.'
                  : `Compliance advice: ${advice.outcome}, recommends ${advice.recommendation} (${advice.given_by_name || nameOf(advice.given_by)}).${advice.outcome === 'Not supportive' ? ' Approving needs a rationale that states the deviation.' : ''}`}
              </span>
            </div>
          )}
          {!selfSignOff && <p className="text-xs text-muted-foreground">Four-eyes: the person who submitted the case ({nameOf(kycCase.sign_off_submitted_by)}) and the Compliance adviser cannot take this decision.</p>}
          {!reportReflectsAdvice && (
            <div className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-900">Generate a report version that includes the Compliance advice (below) before deciding.</div>
          )}

          {canDecide ? (
            <>
              {!selfSignOff && <SignOffProfilePanel kycCase={kycCase} client={client} currentUser={currentUser} />}
              <SignOffTmOutcome kycCase={kycCase} value={amlAssessment} onChange={setAmlAssessment} />
              <div className="flex flex-wrap gap-2">
                {!isUnacceptable && (
                  selfSignOff
                    ? <Button className="gap-2 bg-emerald-600 text-white hover:bg-emerald-700" disabled={!!busy} onClick={() => run('approve', {}, 'Approved (self sign-off)')}>
                        {busy === 'approve' ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle className="h-4 w-4" />} Approve (self sign-off)</Button>
                    : <Button className="gap-2 bg-emerald-600 text-white hover:bg-emerald-700" disabled={!!busy || !reportReflectsAdvice} onClick={() => setDlg('approve')}><CheckCircle className="h-4 w-4" /> Approve</Button>
                )}
                {isUnacceptable && (
                  <Button className="gap-2 bg-red-600 text-white hover:bg-red-700" disabled={!!busy || !reportReflectsAdvice} onClick={() => setDlg(isExisting ? 'terminate' : 'decline')}>
                    {isExisting ? <Ban className="h-4 w-4" /> : <XCircle className="h-4 w-4" />} {isExisting ? 'Terminate relationship' : 'Decline relationship'}
                  </Button>
                )}
                {!selfSignOff && perms.canReturn && <Button variant="outline" className="gap-2" disabled={!!busy} onClick={() => setDlg('return')}><Undo2 className="h-4 w-4" /> {isUnacceptable ? 'Return to reclassify' : 'Return to QC'}</Button>}
                {perms.canEscalate && <Button variant="outline" className="gap-2" disabled={!!busy} onClick={() => setDlg('escalate')}><ArrowUpRight className="h-4 w-4" /> Escalate to Senior Management</Button>}
              </div>
              {selfSignOff && <p className="text-[11px] text-muted-foreground">Low risk: self sign-off is a policy exception for Low/Low cases; it is recorded in the audit trail.</p>}
            </>
          ) : (
            <p className="text-sm text-muted-foreground">
              {adviceOutdated ? 'Waiting for Compliance to confirm or revise the advice.'
                : perms.blockedFourEyes ? `You submitted this case. ${LEVEL_TEXT[route?.level]} must decide.`
                  : perms.blockedAdviser ? 'You gave the Compliance advice on this case and cannot approve it.'
                    : perms.complianceOnly ? 'Compliance has advised and cannot approve this case.'
                      : `With ${LEVEL_TEXT[route?.level]}. You do not have the authority for this decision.`}
            </p>
          )}
        </section>
      )}

      {/* Final seal */}
      {decided && finalDecision && (
        <section className={cn('space-y-2 rounded-xl border-2 p-4', SEAL[status][1])}>
          <div className="flex items-center gap-2 text-sm font-bold tracking-wide"><ShieldCheck className="h-5 w-5" /> {SEAL[status][0]}</div>
          <div className="grid gap-x-6 gap-y-1 text-xs sm:grid-cols-2">
            <span>Decided by: <strong>{finalDecision.decided_by_name}</strong> ({finalDecision.role}, acting as {LEVEL_TEXT[finalDecision.acting_as] || finalDecision.acting_as})</span>
            <span>At: {format(new Date(finalDecision.decided_at), 'd MMM yyyy HH:mm')}</span>
            <span>Report version: {frozen ? `v${frozen.version_number}` : 'final version not generated yet'}</span>
            <span className="font-mono break-all">Hash: {frozen?.hash || finalDecision.hash || '—'}</span>
          </div>
          {finalDecision.rationale && <p className="text-sm">{finalDecision.rationale}{finalDecision.rationale_ai_assisted && <span className="ml-1 rounded bg-violet-100 px-1.5 text-[10px] text-violet-800">AI-assisted draft, confirmed by the approver</span>}</p>}
          {finalDecision.deviates_from_advice && <p className="text-xs font-medium">This decision deviates from the Compliance advice.</p>}
          {finalDecision.reporting_obligation_assessment && <p className="text-xs">Reporting obligation: {finalDecision.reporting_obligation_assessment.replace(/_/g, ' ')} · Neutral letter: {finalDecision.neutral_letter_sent ? 'yes' : 'no'}</p>}
          {perms.canReopen && <Button size="sm" variant="outline" className="gap-1.5" onClick={() => setDlg('reopen')}><RotateCcw className="h-3.5 w-3.5" /> Reopen case</Button>}
        </section>
      )}
      {decided && !frozen && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          Generate the {SEAL[status][0]} report version below. It is frozen (hash recorded) right after it is generated.
          {freezing && <Loader2 className="ml-2 inline h-4 w-4 animate-spin" />}
        </div>
      )}

      {/* Report versions; generating after the decision freezes that version */}
      <section className="border-t border-border pt-5">
        <KycReportStep kycCase={kycCase} client={client} currentUser={currentUser} signoff={ctx}
          onGenerated={async (r) => { if (decided && r && !frozen) await freeze(r); else await reload(); }}
          onPreview={(r) => setPreview(r)} />
      </section>

      <RationaleDialog open={['approve', 'return', 'decline', 'terminate', 'escalate', 'reopen'].includes(dlg)} onOpenChange={(v) => !v && setDlg('')}
        kind={dlg} caseId={kycCase.id} adviceRecommendation={advice?.status === 'received' ? advice.recommendation : null} busy={busy}
        onConfirm={(p) => run(dlg, p, { approve: 'Case approved', return: 'Returned to Draft Report & QC', decline: 'Relationship declined', terminate: 'Relationship terminated', escalate: 'Escalated to Senior Management', reopen: 'Case reopened' }[dlg])} />
      <ReportPreviewPanel open={!!preview} onOpenChange={(v) => !v && setPreview(null)} report={preview} label={ctx.phaseLabel} advice={advice} />
    </div>
  );
}
