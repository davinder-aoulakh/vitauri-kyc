import React, { useState } from 'react';
import { useToast } from '@/components/ui/use-toast';
import { Button } from '@/components/ui/button';
import { Download, Loader2 } from 'lucide-react';
import { openFile } from '@/hooks/useFiuReport';
import InlineError from '@/components/shared/InlineError';
import ReasonDialog from '@/components/tm/report/ReasonDialog';
import EvidenceDialog from '@/components/tm/report/EvidenceDialog';
import { rank } from '@/lib/fiuReport';

export default function ReportFooter({ report, isCO, isPreparer, editing, setEditing, pastDue, act, busy }) {
  const { toast } = useToast();
  const [dlg, setDlg] = useState('');
  const s = report.status;
  const missing = (report.missing_fields || []).length;
  const generate = () => act('generateDiditFiuReport', { action: 'generate' }, 'goAML file generated');
  const approveAndGenerate = async (lateness) => {
    const ok = await act('fiuReportAction', { action: 'approve', ...(lateness ? { lateness_reason: lateness } : {}) }, 'Report approved');
    if (ok) await generate();
    return !!ok;
  };
  const record = (action, extra, msg) => act('recordFiuSubmission', { action, ...extra }, msg).then(Boolean);
  const Dl = ({ kind, children }) => <Button variant="outline" size="sm" className="gap-1.5" onClick={() => openFile(report.id, kind, toast)}><Download className="w-3.5 h-3.5" /> {children}</Button>;

  return (
    <div className="sticky bottom-0 mt-5 bg-card border border-border rounded-xl px-4 py-3 space-y-2 shadow-sm">
      {s === 'approved' && report.generation_error && <InlineError message={`goAML generation failed: ${report.generation_error}`} onRetry={isCO ? generate : undefined} retryLabel="Retry" />}
      <div className="flex flex-wrap items-center gap-2">
        {s === 'draft' && <Button variant="outline" size="sm" onClick={() => setEditing(!editing)}>{editing ? 'Done editing' : 'Edit report'}</Button>}
        {s === 'draft' && <Button size="sm" disabled={!!busy || missing > 0} title={missing ? 'Complete the missing fields first' : ''} onClick={() => act('fiuReportAction', { action: 'submit_for_approval' }, 'Sent for approval')}>
          {busy === 'submit_for_approval' && <Loader2 className="w-3.5 h-3.5 animate-spin" />} Send for approval</Button>}
        {s === 'in_review' && isCO && <Button variant="outline" size="sm" disabled={!!busy} onClick={() => setDlg('reject')}>Send back</Button>}
        {s === 'in_review' && isCO && <Button size="sm" disabled={!!busy || isPreparer} title={isPreparer ? 'Another Compliance Officer must approve' : ''} onClick={() => (pastDue && !report.lateness_reason ? setDlg('late') : approveAndGenerate())}>
          {(busy === 'approve' || busy === 'generate') && <Loader2 className="w-3.5 h-3.5 animate-spin" />} Approve &amp; generate goAML</Button>}
        {s === 'approved' && isCO && <Button size="sm" disabled={!!busy} onClick={generate}>{busy === 'generate' && <Loader2 className="w-3.5 h-3.5 animate-spin" />} Generate goAML</Button>}
        {rank(report) >= 3 && report.generated?.file_url && <Dl kind="xml">Download goAML XML</Dl>}
        {rank(report) >= 3 && report.generated?.pdf_url && <Dl kind="pdf">Download PDF</Dl>}
        {s === 'generated' && isCO && <Button size="sm" onClick={() => setDlg('submitted')}>Record submission</Button>}
        {s === 'submitted' && isCO && <Button size="sm" onClick={() => setDlg('received')}>Record receipt</Button>}
        {report.submitted?.evidence_url && <Dl kind="submitted">Submission evidence</Dl>}
        {report.received?.evidence_url && <Dl kind="received">Receipt evidence</Dl>}
        {s === 'received' && isCO && <Button size="sm" disabled={!!busy} onClick={() => record('accepted', {}, 'Marked accepted')}>Mark accepted</Button>}
        {['submitted', 'received'].includes(s) && isCO && <Button variant="outline" size="sm" onClick={() => setDlg('fiu_rejected')}>FIU rejected</Button>}
      </div>
      <p className="text-xs text-muted-foreground">
        {s === 'generated' ? 'The report only counts as submitted with that evidence.' : s === 'received' || s === 'accepted' ? `FIU reference: ${report.received?.fiu_reference || '—'}` : s === 'rejected' ? `Rejected by the FIU: ${report.rejection_reason || ''}` : ''}
      </p>
      <ReasonDialog open={dlg === 'reject'} onOpenChange={(v) => !v && setDlg('')} title="Send back to draft" description="The report returns to draft as a new version." label="Reason" confirmLabel="Send back" busy={!!busy}
        onSubmit={(reason) => act('fiuReportAction', { action: 'reject', reason }, 'Sent back to draft').then(Boolean)} />
      <ReasonDialog open={dlg === 'late'} onOpenChange={(v) => !v && setDlg('')} title="Report is past its deadline" description="Record why the report is late. It is stored with the approval." label="Lateness reason" confirmLabel="Approve & generate" busy={!!busy}
        onSubmit={approveAndGenerate} />
      <ReasonDialog open={dlg === 'fiu_rejected'} onOpenChange={(v) => !v && setDlg('')} title="Rejected by the FIU" label="Reason given by the FIU" confirmLabel="Record rejection" busy={!!busy}
        onSubmit={(reason) => record('rejected', { reason }, 'Rejection recorded')} />
      <EvidenceDialog open={dlg === 'submitted'} onOpenChange={(v) => !v && setDlg('')} mode="submitted" busy={!!busy} onSubmit={(p) => record('submitted', p, 'Submission recorded')} />
      <EvidenceDialog open={dlg === 'received'} onOpenChange={(v) => !v && setDlg('')} mode="received" busy={!!busy} onSubmit={(p) => record('received', p, 'Receipt recorded')} />
    </div>
  );
}