import React, { useEffect, useMemo, useRef, useState } from 'react';
import { base44 } from '@/api/base44Client';
import { useSignoff, errText } from '@/hooks/useSignoff';
import { useTenantUsers } from '@/hooks/useTenantData';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { toast } from '@/components/ui/use-toast';
import { cn } from '@/lib/utils';
import { format } from 'date-fns';
import { AlertTriangle, Bold, Italic, List, Loader2, Paperclip, Plus, Sparkles, Trash2, Upload, MessageSquareReply } from 'lucide-react';
import ReportPreviewPanel, { ReportRow } from '@/components/case/signoff/ReportPreviewPanel';
import RationaleDialog from '@/components/case/signoff/RationaleDialog';
import DeclinedMatchBanner from '@/components/case/signoff/DeclinedMatchBanner';
import { RouteLine, Locked, reportContext, ADVICE_STATUS, LEVEL_TEXT } from '@/components/case/signoff/SignoffBits';

const OUTCOMES = ['Supportive', 'Supportive with conditions', 'Not supportive'];
const RECS = ['Approve', 'Decline', 'Reclassify'];
const sanitize = (html) => String(html || '').replace(/<script[\s\S]*?<\/script>/gi, '').replace(/ on\w+="[^"]*"/gi, '');

/** Small rich-text editor: bold, italic, list; resizable. */
function AdviceEditor({ value, onChange, disabled }) {
  const ref = useRef(null);
  useEffect(() => { if (ref.current && ref.current.innerHTML !== value) ref.current.innerHTML = value || ''; }, [value]);
  const cmd = (c) => { ref.current?.focus(); document.execCommand(c); onChange(ref.current?.innerHTML || ''); };
  return (
    <div className="rounded-md border border-border">
      <div className="flex gap-1 border-b border-border bg-muted/40 px-2 py-1">
        <Button type="button" size="sm" variant="ghost" className="h-7 w-7 p-0" aria-label="Bold" onClick={() => cmd('bold')} disabled={disabled}><Bold className="h-3.5 w-3.5" /></Button>
        <Button type="button" size="sm" variant="ghost" className="h-7 w-7 p-0" aria-label="Italic" onClick={() => cmd('italic')} disabled={disabled}><Italic className="h-3.5 w-3.5" /></Button>
        <Button type="button" size="sm" variant="ghost" className="h-7 w-7 p-0" aria-label="Bulleted list" onClick={() => cmd('insertUnorderedList')} disabled={disabled}><List className="h-3.5 w-3.5" /></Button>
      </div>
      <div ref={ref} role="textbox" aria-multiline="true" aria-label="Compliance advice" contentEditable={!disabled} suppressContentEditableWarning
        onInput={() => onChange(ref.current?.innerHTML || '')}
        className="prose prose-sm max-w-none min-h-56 resize-y overflow-auto px-3 py-2 text-sm outline-none [&_h4]:mt-2 [&_h4]:font-semibold [&_ul]:list-disc [&_ul]:pl-5"
        style={{ resize: 'vertical' }} />
    </div>
  );
}

function AdviceView({ advice, users }) {
  const by = users.find((u) => u.id === advice.given_by);
  return (
    <section className="space-y-3 rounded-xl border border-violet-200 bg-violet-50/40 p-4">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="font-semibold">Compliance advice</span>
        <span className={cn('rounded-full px-2 py-0.5 text-[11px] font-semibold', advice.outcome === 'Not supportive' ? 'bg-red-100 text-red-800' : 'bg-emerald-100 text-emerald-800')}>{advice.outcome}</span>
        <span className="rounded-full bg-card px-2 py-0.5 text-[11px] border border-border">Recommends: {advice.recommendation}</span>
        {advice.ai_assisted && <span className="rounded-full bg-violet-100 px-2 py-0.5 text-[10px] text-violet-800">AI-assisted draft · author: {advice.given_by_name || by?.full_name}</span>}
      </div>
      <div className="prose prose-sm max-w-none text-sm [&_ul]:list-disc [&_ul]:pl-5" dangerouslySetInnerHTML={{ __html: sanitize(advice.advice_html) }} />
      {(advice.conditions || []).length > 0 && (
        <div><div className="text-xs font-semibold">Conditions (carried to Control Measures)</div><ul className="ml-4 list-disc text-sm">{advice.conditions.map((c) => <li key={c}>{c}</li>)}</ul></div>
      )}
      {(advice.attachments || []).length > 0 && (
        <div className="text-xs text-muted-foreground">Attachments: {advice.attachments.map((a) => `${a.index} ${a.title}`).join(' · ')} (in the report preview)</div>
      )}
      <div className="text-[11px] text-muted-foreground">Given by {advice.given_by_name || by?.full_name || '—'} · {advice.given_at ? format(new Date(advice.given_at), 'd MMM yyyy HH:mm') : ''}</div>
    </section>
  );
}

/** Step "Compliance Advice" (spec §6.3). */
export default function ComplianceAdviceStep({ kycCase, client, currentUser, onCaseUpdate, onNavigateToStep }) {
  const { info, route, perms, advice, decisions, reports, busy, act } = useSignoff(kycCase, onCaseUpdate);
  const { data: users = [] } = useTenantUsers(currentUser?.tenant_id);
  const [outcome, setOutcome] = useState('');
  const [rec, setRec] = useState('');
  const [html, setHtml] = useState('');
  const [aiUsed, setAiUsed] = useState(false);
  const [drafting, setDrafting] = useState(false);
  const [conditions, setConditions] = useState([]);
  const [attachments, setAttachments] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState('');
  const [dlg, setDlg] = useState('');
  const [revise, setRevise] = useState(false);
  const [preview, setPreview] = useState(null);
  const ctx = useMemo(() => reportContext({ kycCase, route, advice, decisions, users }), [kycCase, route, advice, decisions, users]);

  if (!info) return <div className="flex justify-center py-10"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>;
  if (!route?.needsAdvice) return <Locked>Compliance advice is not required for this case ({route?.effective || 'no classification yet'}). It is needed from High risk upwards{info.config?.compliance_advice_enabled === false ? ', and it is switched off for this tenant' : ''}.</Locked>;

  const status = kycCase.signoff_status || 'draft';
  const headings = info.config?.advice_template_headings || [];
  const report = reports.find((r) => r.status !== 'Superseded') || null;
  const isCompliance = !!perms.canGiveAdvice;
  const formOpen = isCompliance && (status === 'with_compliance' || (advice?.status === 'outdated' && revise));
  const openQuestion = (advice?.questions || []).filter((q) => !q.answer).pop();

  const insertTemplate = () => { setHtml(headings.map((h) => `<h4>${h}</h4><p></p>`).join('')); };
  const draftAi = async () => {
    setDrafting(true);
    try {
      const res = (await base44.functions.invoke('caseSignoffAction', { case_id: kycCase.id, action: 'ai_draft_advice' }))?.data || {};
      if (res.error) throw new Error(res.error);
      setHtml(res.html || ''); setAiUsed(true);
    } catch (e) { toast({ variant: 'destructive', title: 'AI draft failed', description: errText(e) }); } finally { setDrafting(false); }
  };
  const upload = async (file) => {
    if (!file) return;
    if (file.size > 20 * 1024 * 1024) { toast({ variant: 'destructive', title: 'File too large (max 20 MB)' }); return; }
    setUploading(true);
    try {
      const { file_uri } = await base44.integrations.Core.UploadPrivateFile({ file });
      setAttachments((a) => [...a, { title: file.name.replace(/\.[^.]+$/, ''), description: '', file_url: file_uri, file_name: file.name, size: file.size }]);
    } catch (e) { toast({ variant: 'destructive', title: 'Upload failed', description: errText(e) }); } finally { setUploading(false); }
  };
  const submitAdvice = () => act('give_advice', { outcome, recommendation: rec, advice_html: sanitize(html), ai_assisted: aiUsed, conditions: conditions.map((c) => c.trim()).filter(Boolean), attachments }, 'Advice submitted — the case went to the approver').then((r) => { if (r) setRevise(false); });
  const textLen = String(html).replace(/<[^>]+>/g, '').trim().length;
  const canSubmitAdvice = outcome && rec && textLen >= 20 && attachments.every((a) => a.title.trim());

  return (
    <div className="space-y-5">
      <RouteLine route={route} />
      <DeclinedMatchBanner caseId={kycCase.id} matches={info?.declined_matches || []} canView={!!info?.can_view_declined} />

      {/* Status for everybody */}
      <section className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-card p-4 text-sm">
        <span className="font-semibold">Status:</span>
        <span className={cn('rounded-full px-2 py-0.5 text-xs font-medium', kycCase.advice_state === 'received' ? 'bg-emerald-100 text-emerald-800' : kycCase.advice_state === 'outdated' ? 'bg-red-100 text-red-800' : 'bg-amber-100 text-amber-900')}>
          {ADVICE_STATUS[kycCase.advice_state || 'none']}
        </span>
        {status === 'draft' && kycCase.advice_state !== 'received' && <span className="text-xs text-muted-foreground">Compliance advice has not been requested yet. It is requested when the analyst submits the case for review.</span>}
        {status === 'with_compliance' && !isCompliance && <span className="text-xs text-muted-foreground">With Compliance. {perms.canGiveAdvice === false && kycCase.sign_off_submitted_by === currentUser?.id ? 'You submitted this case, so you cannot give the advice.' : ''}</span>}
      </section>

      {advice?.status === 'outdated' && (
        <div className="space-y-2 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-900">
          <div className="flex items-center gap-2 font-semibold"><AlertTriangle className="h-4 w-4" /> The advice is outdated</div>
          <p className="text-xs">It was given for {advice.valid_for_key?.replace('|', ' → ')}; the case is now {route.existing || 'New'} → {route.proposed}. The case cannot be signed off until Compliance confirms or revises it.</p>
          {isCompliance && !revise && (
            <div className="flex gap-2">
              <Button size="sm" disabled={!!busy} onClick={() => act('confirm_advice', {}, 'Advice confirmed')}>Confirm advice is still valid</Button>
              <Button size="sm" variant="outline" onClick={() => { setRevise(true); setOutcome(advice.outcome); setRec(advice.recommendation); setHtml(advice.advice_html || ''); setConditions(advice.conditions || []); setAttachments(advice.attachments || []); }}>Revise advice</Button>
            </div>
          )}
        </div>
      )}

      {/* More information: question from Compliance, answer by the analyst */}
      {(advice?.questions || []).length > 0 && (
        <section className="space-y-2 rounded-xl border border-border bg-card p-4">
          <div className="text-sm font-semibold">Questions from Compliance</div>
          {advice.questions.map((q, i) => (
            <div key={i} className="space-y-1 rounded-md bg-muted/40 p-2 text-xs">
              <div><span className="font-medium">{q.asked_by}:</span> {q.question}</div>
              {q.answer && <div className="pl-3 text-muted-foreground"><span className="font-medium text-foreground">{q.answered_by}:</span> {q.answer}</div>}
            </div>
          ))}
          {status === 'info_needed' && openQuestion && perms.canSubmit && !isCompliance && (
            <div className="space-y-2">
              <Textarea value={answer} onChange={(e) => setAnswer(e.target.value)} className="min-h-20 text-sm" placeholder="Your answer to Compliance" />
              <Button size="sm" className="gap-1.5" disabled={answer.trim().length < 5 || !!busy} onClick={() => act('answer_info', { answer }, 'Answer sent to Compliance').then((r) => r && setAnswer(''))}>
                <MessageSquareReply className="h-3.5 w-3.5" /> Send answer
              </Button>
            </div>
          )}
        </section>
      )}

      {advice && ['received', 'outdated'].includes(advice.status) && !formOpen && <AdviceView advice={advice} users={users} />}

      {/* Compliance review screen */}
      {formOpen && (
        <>
          <section className="space-y-2 rounded-xl border border-border bg-card p-4 text-sm">
            <div className="font-semibold">Case for review</div>
            <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-xs">
              <span className="text-muted-foreground">Client</span><span>{client?.full_name} ({client?.client_type})</span>
              <span className="text-muted-foreground">Case type</span><span>{String(kycCase.case_type || '').replace(/_/g, ' ')}</span>
              <span className="text-muted-foreground">Classification</span><span>{route.existing ? `${route.existing} → ` : ''}{route.proposed} (effective {route.effective})</span>
              <span className="text-muted-foreground">Sign-off after advice</span><span>{LEVEL_TEXT[route.level]}</span>
            </div>
            {kycCase.downgrade_motivation && <p className="text-xs"><span className="font-medium">Downgrade motivation:</span> {kycCase.downgrade_motivation}</p>}
            {(kycCase.submitted_note || advice?.analyst_note) && <p className="text-xs"><span className="font-medium">Analyst note:</span> {kycCase.submitted_note || advice?.analyst_note}</p>}
            <ReportRow report={report} label={ctx.phaseLabel} onPreview={setPreview} />
          </section>

          <section className="space-y-4 rounded-xl border border-border bg-card p-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <fieldset className="space-y-1.5">
                <legend className="text-xs font-semibold">Outcome</legend>
                {OUTCOMES.map((o) => <label key={o} className="flex items-center gap-2 text-sm"><input type="radio" name="outcome" checked={outcome === o} onChange={() => setOutcome(o)} /> {o}</label>)}
              </fieldset>
              <fieldset className="space-y-1.5">
                <legend className="text-xs font-semibold">Recommendation</legend>
                {RECS.map((r) => {
                  const off = r === 'Approve' && route.effective === 'Unacceptable';
                  return <label key={r} className={cn('flex items-center gap-2 text-sm', off && 'opacity-40')}><input type="radio" name="rec" disabled={off} checked={rec === r} onChange={() => setRec(r)} /> {r}{off && ' (not possible for Unacceptable)'}</label>;
                })}
              </fieldset>
            </div>
            <div className="space-y-1.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-xs font-semibold">Advice</span>
                <div className="flex gap-2">
                  <Button type="button" size="sm" variant="outline" className="h-7 text-xs" onClick={insertTemplate}>Insert template</Button>
                  <Button type="button" size="sm" variant="outline" className="h-7 gap-1 text-xs" disabled={drafting} onClick={draftAi}>
                    {drafting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />} Draft with AI
                  </Button>
                </div>
              </div>
              <AdviceEditor value={html} onChange={setHtml} />
              {aiUsed && <p className="text-[11px] text-violet-700">AI-assisted draft · you remain the author. Edit it before you submit.</p>}
            </div>
            <div className="space-y-1.5">
              <div className="flex items-center justify-between"><span className="text-xs font-semibold">Conditions (each becomes a proposed control measure)</span>
                <Button type="button" size="sm" variant="ghost" className="h-7 gap-1 text-xs" onClick={() => setConditions((c) => [...c, ''])}><Plus className="h-3.5 w-3.5" /> Add</Button></div>
              {conditions.map((c, i) => (
                <div key={i} className="flex gap-2">
                  <Input value={c} onChange={(e) => setConditions((cs) => cs.map((x, j) => (j === i ? e.target.value : x)))} className="h-8 text-sm" placeholder="e.g. Quarterly review of incoming transfers above EUR 25,000" />
                  <Button type="button" size="sm" variant="ghost" className="h-8 w-8 p-0" aria-label="Remove condition" onClick={() => setConditions((cs) => cs.filter((_, j) => j !== i))}><Trash2 className="h-3.5 w-3.5" /></Button>
                </div>
              ))}
            </div>
            <div className="space-y-1.5">
              <div className="flex items-center justify-between"><span className="text-xs font-semibold">Attachments (C1, C2…)</span>
                <label className="inline-flex cursor-pointer items-center gap-1 text-xs text-primary hover:underline">
                  {uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />} Add file
                  <input type="file" className="hidden" onChange={(e) => { upload(e.target.files?.[0]); e.target.value = ''; }} />
                </label></div>
              {attachments.map((a, i) => (
                <div key={i} className="grid gap-2 rounded-md border border-border p-2 sm:grid-cols-[3rem_1fr_1.5fr_2rem]">
                  <span className="flex items-center gap-1 text-xs font-semibold"><Paperclip className="h-3 w-3" />C{i + 1}</span>
                  <Input value={a.title} onChange={(e) => setAttachments((as) => as.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)))} className="h-8 text-sm" placeholder="Title" />
                  <Input value={a.description} onChange={(e) => setAttachments((as) => as.map((x, j) => (j === i ? { ...x, description: e.target.value } : x)))} className="h-8 text-sm" placeholder="Description" />
                  <Button type="button" size="sm" variant="ghost" className="h-8 w-8 p-0" aria-label="Remove attachment" onClick={() => setAttachments((as) => as.filter((_, j) => j !== i))}><Trash2 className="h-3.5 w-3.5" /></Button>
                </div>
              ))}
            </div>
            <div className="flex flex-wrap gap-2 border-t border-border pt-3">
              <Button disabled={!canSubmitAdvice || !!busy} onClick={submitAdvice}>{busy === 'give_advice' && <Loader2 className="h-4 w-4 animate-spin" />} Submit advice</Button>
              {status === 'with_compliance' && <>
                <Button variant="outline" disabled={!!busy} onClick={() => setDlg('ask')}>Request more information</Button>
                <Button variant="outline" className="text-red-700" disabled={!!busy} onClick={() => setDlg('return_to_analyst')}>Return to analyst (changes needed)</Button>
              </>}
            </div>
            {dlg === 'ask' && (
              <div className="space-y-2 rounded-md border border-border p-3">
                <Textarea value={question} onChange={(e) => setQuestion(e.target.value)} className="min-h-20 text-sm" placeholder="Your question to the analyst" />
                <div className="flex gap-2"><Button size="sm" disabled={question.trim().length < 10 || !!busy} onClick={() => act('ask_info', { question }, 'Question sent to the analyst').then((r) => { if (r) { setQuestion(''); setDlg(''); } })}>Send question</Button>
                  <Button size="sm" variant="ghost" onClick={() => setDlg('')}>Cancel</Button></div>
              </div>
            )}
          </section>
        </>
      )}

      {!formOpen && status === 'with_compliance' && !isCompliance && report && <ReportRow report={report} label={ctx.phaseLabel} onPreview={setPreview} />}

      <RationaleDialog open={dlg === 'return_to_analyst'} onOpenChange={(v) => !v && setDlg('')} kind="return_to_analyst" caseId={kycCase.id} busy={busy}
        onConfirm={async (p) => { const r = await act('return_to_analyst', p, 'Returned to the analyst'); if (r) onNavigateToStep?.(10); return !!r; }} />
      <ReportPreviewPanel open={!!preview} onOpenChange={(v) => !v && setPreview(null)} report={preview} label={ctx.phaseLabel} advice={advice} />
    </div>
  );
}
