import React, { useMemo, useState } from 'react';
import { useSignoff } from '@/hooks/useSignoff';
import { useTenantUsers } from '@/hooks/useTenantData';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import { format } from 'date-fns';
import { AlertTriangle, CheckCircle, Loader2, Send, ArrowRight } from 'lucide-react';
import KycReportStep from '@/components/case/KycReportStep';
import ReportPreviewPanel from '@/components/case/signoff/ReportPreviewPanel';
import { RouteLine, Stepper, reportContext, LEVEL_TEXT, ADVICE_STATUS } from '@/components/case/signoff/SignoffBits';

const STEP_LABEL = { 1: 'Outreach & Documents', 2: 'Identity / Entity Verification', 3: 'Screening', 4: 'Client / Entity Profile', 5: 'Source of Funds/Wealth', 6: 'Risk Assessment', 7: 'Control Measures' };

/** Step "Draft Report & QC" (spec §6.2). Phase 1: Case Check = steps 1–7 complete; QC engine and human actions follow in phase 2. */
export default function DraftReportQcStep({ kycCase, client, currentUser, onCaseUpdate, onNavigateToStep }) {
  const { info, route, perms, advice, decisions, reports, busy, act, reload } = useSignoff(kycCase, onCaseUpdate);
  const { data: users = [] } = useTenantUsers(currentUser?.tenant_id);
  const [note, setNote] = useState('');
  const [motivation, setMotivation] = useState('');
  const [preview, setPreview] = useState(null);
  const ctx = useMemo(() => reportContext({ kycCase, route, advice, decisions, users }), [kycCase, route, advice, decisions, users]);

  if (!info) return <div className="flex justify-center py-10"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>;
  const status = kycCase.signoff_status || 'draft';
  const isDraft = status === 'draft';
  const incomplete = info.incomplete_steps || [];
  const liveReports = reports.filter((r) => r.status !== 'Superseded');
  const draftReport = liveReports[0] || null;
  const caseCheck = incomplete.length === 0;
  const ready = caseCheck && !!draftReport;
  const submitter = users.find((u) => u.id === kycCase.sign_off_submitted_by);
  const returned = isDraft && (kycCase.returned_reason || kycCase.sign_off_rejection_reason);

  const stepper = [
    { label: 'Case Check', sub: caseCheck ? 'All steps complete' : `${incomplete.length} step(s) open`, state: caseCheck ? 'done' : 'current' },
    { label: 'Draft report', sub: draftReport ? `v${draftReport.version_number}` : 'not generated', state: draftReport ? 'done' : caseCheck ? 'current' : 'todo' },
    { label: 'Report Check', sub: 'AI check arrives in the next release', state: draftReport ? 'done' : 'todo' },
    { label: 'Ready for sign-off', sub: !isDraft ? 'submitted' : ready ? 'ready' : 'after the draft report', state: !isDraft ? 'done' : ready ? 'current' : 'todo' },
  ];

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
            <div className="text-sm font-semibold">{!isDraft ? 'Submitted' : ready ? 'QC passed — ready to submit' : !caseCheck ? 'Case Check: steps still open' : 'Generate the draft report'}</div>
            <p className="text-xs text-muted-foreground">
              {!isDraft ? `Submitted ${kycCase.sign_off_submitted_at ? format(new Date(kycCase.sign_off_submitted_at), 'd MMM yyyy HH:mm') : ''} by ${submitter?.full_name || '—'}.`
                : !caseCheck ? 'Every earlier step must be complete or marked not required before QC can pass.'
                  : !draftReport ? 'Generate the draft report below. It is checked against the case data and goes with the case to review.' : 'Case Check passed and the draft report is ready.'}
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
      </section>

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
          {!ready && <p className="text-[11px] text-muted-foreground">Available once the Case Check has passed and the draft report exists.</p>}
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
