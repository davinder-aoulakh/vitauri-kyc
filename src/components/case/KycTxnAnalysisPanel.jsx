import React, { useState, useEffect, useCallback } from 'react';
import { base44 } from '@/api/base44Client';
import { useTenant } from '@/lib/tenantContext';
import { hasPermission } from '@/lib/permissions';
import { canDecideProfile } from '@/lib/profileApproval';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import InlineError from '@/components/shared/InlineError';
import EmptyState from '@/components/shared/EmptyState';
import StatementUploadDrawer from '@/components/tm/StatementUploadDrawer';
import StatementPicker from './txnanalysis/StatementPicker';
import AnalysisKpis from './txnanalysis/AnalysisKpis';
import CategoryBars from './txnanalysis/CategoryBars';
import AiConclusionBox from './txnanalysis/AiConclusionBox';
import { Loader2, Play, CheckCircle, FileSignature, BarChart3 } from 'lucide-react';

const errMsg = (e) => e?.response?.data?.error || e?.message || 'Something went wrong';
const rangeOf = (uploads) => ({
  from: uploads.map((u) => u.period_from).filter(Boolean).sort()[0] || '',
  to: uploads.map((u) => u.period_to).filter(Boolean).sort().slice(-1)[0] || '',
});

export default function KycTxnAnalysisPanel({ kycCase, onCaseUpdate }) {
  const { currentUser, tenant } = useTenant();
  const tenantId = kycCase?.tenant_id;
  const canAct = hasPermission(currentUser?.app_role, 'createRunCase');

  const [uploads, setUploads] = useState([]);
  const [analysis, setAnalysis] = useState(null);
  const [selected, setSelected] = useState([]);
  const [period, setPeriod] = useState({ from: '', to: '' });
  const [conclusion, setConclusion] = useState('');
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);
  const [info, setInfo] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!tenantId || !kycCase?.client_id) return;
    setError(null);
    try {
      const [ups, list] = await Promise.all([
        base44.entities.StatementUpload.filter({ tenant_id: tenantId, client_id: kycCase.client_id, status: 'committed' }, '-created_date', 50),
        base44.entities.KycTransactionAnalysis.filter({ tenant_id: tenantId, case_id: kycCase.id }, '-created_date', 20),
      ]);
      const current = (list || []).find((a) => a.id === kycCase.kyc_txn_analysis_id) || (list || [])[0] || null;
      setUploads(ups || []);
      setAnalysis(current);
      setConclusion(current?.analyst_conclusion || '');
      const ids = current?.statement_upload_ids?.length ? current.statement_upload_ids : (ups || []).map((u) => u.id);
      setSelected(ids);
      setPeriod(current?.period_from ? { from: current.period_from, to: current.period_to } : rangeOf((ups || []).filter((u) => ids.includes(u.id))));
    } catch (e) {
      setError(errMsg(e));
    }
    setLoading(false);
  }, [tenantId, kycCase?.id, kycCase?.client_id, kycCase?.kyc_txn_analysis_id]);

  useEffect(() => { load(); }, [load]);

  function toggle(id) {
    const next = selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id];
    setSelected(next);
    setPeriod(rangeOf(uploads.filter((u) => next.includes(u.id))));
  }

  async function call(kind, fn) {
    setBusy(kind); setError(null); setInfo(null);
    try { await fn(); } catch (e) { setError(errMsg(e)); }
    setBusy(null);
  }

  const run = () => call('run', async () => {
    const res = await base44.functions.invoke('runKycTransactionAnalysis', {
      case_id: kycCase.id, statement_upload_ids: selected, period_from: period.from, period_to: period.to,
    });
    const a = res.data?.analysis;
    if (a) onCaseUpdate?.((prev) => (prev ? { ...prev, kyc_txn_analysis_id: a.id } : prev));
    if (res.data?.proposal_error) setInfo(`Analysis saved, but the profile proposal failed: ${res.data.proposal_error}`);
    setAnalysis(a); setConclusion('');
  });

  const signOff = () => call('signoff', async () => {
    const res = await base44.functions.invoke('signOffKycTransactionAnalysis', { analysis_id: analysis.id, analyst_conclusion: conclusion });
    setAnalysis(res.data.analysis);
  });

  const propose = () => call('propose', async () => {
    const res = await base44.functions.invoke('proposeExpectedProfile', {
      client_id: kycCase.client_id, case_id: kycCase.id, source: 'kyc_txn_analysis', source_id: analysis.id,
      overrides: analysis.proposed_profile_limits || {},
    });
    const p = res.data?.profile;
    if (p) {
      await base44.entities.KycTransactionAnalysis.update(analysis.id, { proposed_profile_id: p.id, proposed_profile_version: p.version });
      setAnalysis({ ...analysis, proposed_profile_id: p.id, proposed_profile_version: p.version });
      setInfo(`Expected profile v${p.version} proposed for approval.`);
    }
  });

  if (loading) return <div className="flex justify-center py-6"><Loader2 className="w-4 h-4 animate-spin text-muted-foreground" /></div>;

  const signed = analysis?.status === 'signed_off';
  const decision = canDecideProfile({
    role: currentUser?.app_role, userId: currentUser?.id, tenant,
    riskClass: kycCase.risk_classification, proposedBy: analysis?.run_by_user_id,
  });
  const canRun = canAct && selected.length > 0 && period.from && period.to && !busy;

  return (
    <div className="space-y-4">
      <StatementPicker uploads={uploads} selected={selected} onToggle={toggle} period={period} onPeriod={setPeriod} onAdd={() => setDrawerOpen(true)} canEdit={canAct} />

      {canAct && (
        <Button size="sm" className="gap-1.5 text-xs" disabled={!canRun} onClick={run}>
          {busy === 'run' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
          {busy === 'run' ? 'Analysing…' : 'Run analysis'}
        </Button>
      )}

      {error && <InlineError message={error} onRetry={busy ? undefined : load} />}
      {info && <p className="text-xs text-amber-700">{info}</p>}

      {!analysis ? (
        <EmptyState icon={BarChart3} title="No analysis yet" description="Select committed statements and run the analysis." />
      ) : (
        <>
          <AnalysisKpis analysis={analysis} uploads={uploads} />
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <CategoryBars title="Income by category" data={analysis.income_by_category} barClass="bg-success" currency={analysis.currency} />
            <CategoryBars title="Spending by category" data={analysis.spend_by_category} barClass="bg-warning" currency={analysis.currency} />
          </div>
          <AiConclusionBox analysis={analysis} />

          <div className="space-y-2">
            <h5 className="text-xs font-semibold">Analyst conclusion {signed && <span className="ml-1 text-emerald-600">✓ Signed off by {analysis.signed_off_by_name}</span>}</h5>
            <Textarea value={conclusion} onChange={(e) => setConclusion(e.target.value)} disabled={signed || !canAct} className="min-h-20 text-sm" placeholder="Your conclusion on the transaction analysis…" />
            <div className="flex flex-wrap gap-2">
              {canAct && !signed && (
                <Button size="sm" className="gap-1.5 bg-emerald-600 text-xs text-white hover:bg-emerald-700" disabled={!conclusion.trim() || !!busy || !decision} onClick={signOff}>
                  {busy === 'signoff' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle className="w-3.5 h-3.5" />} Sign off analysis
                </Button>
              )}
              {canAct && (
                <Button size="sm" variant="outline" className="gap-1.5 text-xs" disabled={!!busy} onClick={propose}>
                  {busy === 'propose' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <FileSignature className="w-3.5 h-3.5" />} Propose profile for approval
                </Button>
              )}
            </div>
            {canAct && !signed && !decision && (
              <p className="text-xs text-muted-foreground">Sign-off for {kycCase.risk_classification || 'Medium'} risk requires an authorised approver per the sign-off matrix.</p>
            )}
          </div>
        </>
      )}

      <StatementUploadDrawer
        open={drawerOpen} onOpenChange={setDrawerOpen} clientId={kycCase.client_id}
        onCommitted={() => load()}
      />
    </div>
  );
}