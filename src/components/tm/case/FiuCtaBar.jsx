import React, { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import { useToast } from '@/components/ui/use-toast';
import { errorMessage } from '@/lib/tmAlerts';
import { Button } from '@/components/ui/button';
import InlineError from '@/components/shared/InlineError';
import { Loader2 } from 'lucide-react';

export default function FiuCtaBar({ caseId, tenantId, report }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const isDraft = report?.status === 'draft';
  const missing = report?.missing_fields || [];

  const prepare = async () => {
    setBusy(true); setError('');
    try {
      const res = (await base44.functions.invoke('prepareFiuReport', { tm_case_id: caseId }))?.data || {};
      toast({ title: `FIU report ${res.report_ref} ${res.status === 'draft' ? 'saved as draft' : 'ready for review'}` });
      qc.invalidateQueries({ queryKey: ['tmCaseData', tenantId, caseId] });
      navigate(`/tm/report/${res.report_id}`);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-xl bg-purple-600 text-white px-5 py-3.5 mb-5 space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="text-sm font-semibold">{report ? `FIU report ${report.report_ref} · ${report.status.replace('_', ' ')}` : 'Ready to report?'}</div>
          <div className="text-xs text-purple-100">
            {!report && 'Collect the evidence into a draft FIU report for review.'}
            {isDraft && 'Draft: mandatory data is missing, so customer communications are not locked yet.'}
            {report && !isDraft && 'Customer communications are locked while this report is in progress.'}
          </div>
        </div>
        {report && (
          <Button size="sm" variant="outline" className="bg-transparent text-white border-white/50 hover:bg-white/10 hover:text-white" onClick={() => navigate(`/tm/report/${report.id}`)}>Open report</Button>
        )}
        {(!report || isDraft) && (
          <Button size="sm" disabled={busy} className="bg-white text-purple-700 hover:bg-purple-50" onClick={prepare}>
            {busy && <Loader2 className="w-3.5 h-3.5 animate-spin" />} {report ? 'Refresh draft' : '✦ Prepare FIU report'}
          </Button>
        )}
      </div>
      {isDraft && missing.length > 0 && (
        <div className="text-xs text-purple-100">Missing: <span className="font-mono">{missing.join(', ')}</span>. Complete this data in the KYC file or alerts, then refresh the draft.</div>
      )}
      {error && <InlineError message={error} onRetry={prepare} />}
    </div>
  );
}