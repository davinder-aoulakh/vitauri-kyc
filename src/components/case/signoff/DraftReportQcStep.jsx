import React, { useCallback, useMemo, useState } from 'react';
import { useSignoff } from '@/hooks/useSignoff';
import { useQc } from '@/hooks/useQc';
import QcFindingsPanel from '@/components/case/signoff/QcFindingsPanel';
import QcAgentLog from '@/components/case/signoff/QcAgentLog';
import { useTenantUsers } from '@/hooks/useTenantData';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import { format } from 'date-fns';
import { AlertTriangle, CheckCircle, Loader2, Send, ArrowRight, ShieldCheck, RefreshCw } from 'lucide-react';
import KycReportStep from '@/components/case/KycReportStep';
import ReportPreviewPanel from '@/components/case/signoff/ReportPreviewPanel';
import { RouteLine, Stepper, reportContext, LEVEL_TEXT, ADVICE_STATUS } from '@/components/case/signoff/SignoffBits';

const STEP_LABEL = { 1: 'Outreach & Documents', 2: 'Identity / Entity Verification', 3: 'Screening', 4: 'Client / Entity Profile', 5: 'Source of Funds/Wealth', 6: 'Risk Assessment', 7: 'Control Measures' };

/** Step "Draft Report & QC" (spec §6.2): Case Check (rules) + Report Check (Claude), max 3 rounds, human decisions; QC is a hard gate for Submit. */
export default function DraftReportQcStep({ kycCase, client, currentUser, onCaseUpdate, onNavigateToStep }) {
  const { info, route, perms, advice, decisions, reports, busy, act, reload } = useSignoff(kycCase, onCaseUpdate);
  const { data: users = [] } = useTenantUsers(currentUser?.tenant_id);
  const [note, setNote] = useState('');
  const [motivation, setMotivation] = useState('');
  const [preview, setPreview] = useState(null);
  const onQcChanged = useCallback(() => { reload(); }, [reload]);
  const { qc, busy: qcBusy, act: qcAct } = useQc(kycCase?.id, onQcChanged);
  const ctx = useMemo(() => reportContext({ kycCase, route, advice, decisions, users }), [kycCase, route, advice, decisions, users]);

  if (!info) return <div className="flex justify-center py-10"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>;
  const status = kycCase.signoff_status || 'draft';
  const isDraft = status === 'draft';
  const incomplete = info.incomplete_steps || [];
  const liveReports = reports.filter((r) => r.status !== 'Superseded');
  const draftReport = liveReports[0] || null;
  const caseCheck = incomplete.length === 0;
  const run = qc?.run || null;
  const findings = qc?.findings || [];
  const running = run?.result === 'running';
  const legacy = kycCase.qc_state === 'legacy';
  const qcPassed = !!info.qc_passed;
  const stale = !!info.qc_stale || !!qc?.stale;
  const roundsUsed = ['not_run', undefined, null].includes(kycCase.qc_state) ? 0 : (qc?.rounds_used || 0);
  const maxRounds = qc?.max_rounds || 3;
  const openOf = (check) => findings.filter((f) => f.check === check && ['open', 'returned', 'needs_human'].includes(f.status)).length;
  const ready = qcPassed;
  const submitter = users.find((u) => u.id === kycCase.sign_off_submitted_by);
  const returned = isDraft && (kycCase.returned_reason || kycCase.sign_off_rejection_reason);

  const rc = run?.report_check;
  const stepper = legacy ? [
    { label: 'QC', sub: 'legacy case — not run', state: 'done' },
    { label: 'Ready for sign-off', sub: !isDraft ? 'submitted' : 'ready', state: !isDraft ? 'done' : 'current' },
  ] : [
    { label: 'Case Check', sub: !run ? (caseCheck ? 'steps complete · not run' : `${incomplete.length} step(s) open`) : running ? 'running…' : openOf('case') ? `${openOf('case')} open` : 'passed', state: run && !running && !openOf('case') ? 'done' : 'current' },
    { label: 'Draft report', sub: draftReport ? `v${draftReport.version_number}` : 'not generated', state: draftReport ? 'done' : caseCheck ? 'current' : 'todo' },
    { label: 'Report Check', sub: !run ? 'Claude · not run' : running ? 'running…' : rc?.status === 'skipped' ? 'skipped' : rc?.status === 'error' ? 'error' : openOf('report') ? `${openOf('report')} open` : 'passed', state: run && !running && !openOf('report') ? 'done' : run ? 'current' : 'todo' },
    { label: 'Ready for sign-off', sub: !isDraft ? 'submitted' : ready ? `QC passed${run?.certificate_id ? ` · ${run.certificate_id}` : ''}` : 'after QC passes', state: !isDraft || ready ? 'done' : 'todo' },
  ];
  const runQc = () => qcAct('run', {}, `QC round ${roundsUsed + 1} started`);

  const submit = async () => {
    const res = await act('submit', { note, downgrade_motivation: motivation }, route?.level === 'analyst' ? 'Continued to sign-off' : 'Submitted for review');
    if (res && route?.level === 'analyst') onNavigateToStep?.(8);
  };

  return (
    <div className="space-y-5">
      <RouteLine route={route} />

      {returned && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-900">
          <div className="flex items-center gap-2 font-semibold"><AlertTriangle className="h-4 w-4" /> Returned for changes</div>
          <p className="mt-1 text-xs">{kycCase.returned_reason || kycCase.sign_off_rejection_reason}</p>
        </div>
      )}
      {status === 'info_needed' && (
        <div className="flex items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          <span>Compliance asked for more information. Answer in the Compliance Advice step.</span>
          <Button size="sm" variant="outline" onClick={() => onNavigateToStep?.(11)}>Open Compliance Advice</Button>
        </div>
      )}

      {/* Status card */}
      <section className="space-y-4 rounded-xl border border-border bg-card p-4">
        <div className="flex items-start gap-3">
          {ready || !isDraft ? <CheckCircle className="mt-0.5 h-5 w-5 text-emerald-600" /> : <AlertTriangle className="mt-0.5 h-5 w-5 text-amber-600" />}
          <div className="flex-1">
            <div className="text-sm font-semibold">{!isDraft ? 'Submitted' : ready ? 'QC passed — ready to submit' : running ? 'QC is running…' : stale ? 'The case changed after QC passed' : run?.result === 'paused' ? 'QC paused — a person must decide' : kycCase.qc_state === 'waiting_client' ? 'QC waits for the client' : run?.result === 'failed' ? 'QC found issues' : run?.result === 'error' ? 'QC could not finish' : !draftReport ? 'Generate the draft report' : 'Run QC'}</div>
            <p className="text-xs text-muted-foreground">
              {!isDraft ? `Submitted ${kycCase.sign_off_submitted_at ? format(new Date(kycCase.sign_off_submitted_at), 'd MMM yyyy HH:mm') : ''} by ${submitter?.full_name || '—'}.`
                : legacy ? 'This case started before the QC engine; QC is recorded as "legacy — not run".'
                  : ready ? `Certificate ${run?.certificate_id || '—'} · round ${run?.round || 1} of ${maxRounds}.`
                    : stale ? 'Re-run QC so the checks match the current case data.'
                      : running ? 'The Case Check runs the rules; Claude then checks the draft report against the case data. This takes about a minute.'
                        : run?.result === 'error' ? (run.error || 'Try again.')
                          : !draftReport ? 'Generate the draft report below, then run QC. Claude checks the report against the case data.'
                            : run ? `Round ${run.round || 1} of ${maxRounds}. Fix the findings in their steps (or decide the human checks), regenerate the draft report if needed, then re-run QC.` : 'QC checks the case data (rules) and the draft report (Claude). Max 3 rounds.'}
            </p>
            {isDraft && !caseCheck && (
              <ul className="mt-2 flex flex-wrap gap-1.5">
                {incomplete.map((s) => (
                  <li key={s}><button type="button" onClick={() => onNavigateToStep?.(s)} className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[11px] text-amber-900 hover:bg-amber-100">{STEP_LABEL[s]}</button></li>
                ))}
              </ul>
            )}
          </div>
        </div>
        <Stepper items={stepper} />
        {isDraft && !legacy && (
          <div className="flex flex-wrap items-center gap-2 border-t border-border pt-3">
            <Button size="sm" className="gap-1.5" disabled={running || !!qcBusy || roundsUsed >= maxRounds || !draftReport || !perms.canSubmit} onClick={runQc}>
              {qcBusy === 'run' || running ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : run ? <RefreshCw className="h-3.5 w-3.5" /> : <ShieldCheck className="h-3.5 w-3.5" />}
              {run && roundsUsed ? 'Re-run QC' : 'Run QC'} (round {Math.min(roundsUsed + 1, maxRounds)} of {maxRounds})
            </Button>
            {roundsUsed >= maxRounds && !ready && <span className="text-[11px] text-red-700">Maximum rounds reached. Fix the findings manually; a return from review starts a new cycle.</span>}
            {!draftReport && <span className="text-[11px] text-muted-foreground">Generate the draft report first.</span>}
            {rc?.status === 'skipped' && <span className="text-[11px] text-muted-foreground">{rc.summary}</span>}
            <span className="ml-auto text-[11px] text-muted-foreground">Strictness: {qc?.strictness || 'light'}</span>
          </div>
        )}
      </section>

      {/* QC findings (by step) and human decisions */}
      {run && !legacy && !running && (
        <section className="space-y-3 rounded-xl border border-border bg-card p-4">
          <div className="text-sm font-semibold">QC findings · round {run.round || 1}</div>
          {rc?.summary && rc.status === 'done' && <p className="rounded-lg bg-muted/40 p-2 text-xs text-muted-foreground"><span className="font-medium">Report Check ({rc.engine}):</span> {rc.summary}</p>}
          <QcFindingsPanel findings={findings} strictness={run.strictness || qc?.strictness} busy={qcBusy} readOnly={!isDraft}
            onNavigateToStep={onNavigateToStep}
            onDecide={(p) => qcAct('record_human_action', p, 'Decision recorded')}
            onDismiss={(f, reason) => qcAct('dismiss_finding', { finding_id: f.id, reason }, 'Finding dismissed')} />
        </section>
      )}
      <QcAgentLog history={qc?.history || []} actions={qc?.actions || []} />

      {/* Submit for review */}
      {isDraft && route?.level && (
        <section className="space-y-3 rounded-xl border border-border bg-card p-4">
          <div className="text-sm font-semibold">{route.level === 'analyst' ? 'Continue to sign-off' : 'Submit for review'}</div>
          <div className="flex flex-wrap items-center gap-1.5 text-xs">
            {route.needsAdvice && <><span className="rounded-full border border-violet-200 bg-violet-50 px-2 py-0.5 text-violet-800">Compliance advice</span><ArrowRight className="h-3 w-3 text-muted-foreground" /></>}
            <span className="rounded-full border border-blue-200 bg-blue-50 px-2 py-0.5 text-blue-800">{LEVEL_TEXT[route.level]} sign-off</span>
          </div>
          {route.isDowngrade && (
            <div className="space-y-1">
              <label htmlFor="downgrade" className="text-xs font-medium">Downgrade motivation (required: {route.existing} → {route.proposed})</label>
              <Textarea id="downgrade" value={motivation} onChange={(e) => setMotivation(e.target.value)} className="min-h-20 text-sm" placeholder="Why is the risk lower now? This appears in the report." />
            </div>
          )}
          {route.level !== 'analyst' && (
            <div className="space-y-1">
              <label htmlFor="note" className="text-xs font-medium">Note for the reviewer (optional)</label>
              <Textarea id="note" value={note} onChange={(e) => setNote(e.target.value)} className="min-h-16 text-sm" />
            </div>
          )}
          <Button className="gap-2" disabled={!ready || !perms.canSubmit || !!busy || (route.isDowngrade && motivation.trim().length < 10)} onClick={submit}>
            {busy === 'submit' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            {route.level === 'analyst' ? 'Continue to sign-off' : 'Submit for review'}
          </Button>
          {!ready && <p className="text-[11px] text-muted-foreground">Available once QC has passed on the current case data.</p>}
        </section>
      )}

      {/* After submission: read-only stage status */}
      {!isDraft && (
        <section className="space-y-2 rounded-xl border border-border bg-card p-4 text-xs">
          <div className="text-sm font-semibold">Review status</div>
          {route?.needsAdvice && <div className="flex justify-between"><span>Compliance advice</span><span className={cn('font-medium', advice?.status === 'received' ? 'text-emerald-700' : 'text-amber-700')}>{ADVICE_STATUS[kycCase.advice_state || 'none']}</span></div>}
          <div className="flex justify-between"><span>{LEVEL_TEXT[route?.level] || 'Sign-off'}</span><span className="font-medium">{status === 'with_approver' ? 'Waiting' : ['approved', 'declined', 'terminated'].includes(status) ? 'Decided' : 'After Compliance advice'}</span></div>
        </section>
      )}

      {/* Draft report (download only inside the preview panel) */}
      <section className="border-t border-border pt-5">
        <KycReportStep kycCase={kycCase} client={client} currentUser={currentUser} signoff={ctx}
          onGenerated={() => reload()} onPreview={(r) => setPreview(r)} />
      </section>
      <ReportPreviewPanel open={!!preview} onOpenChange={(v) => !v && setPreview(null)} report={preview} label={ctx.phaseLabel} advice={advice} />
    </div>
  );
}
