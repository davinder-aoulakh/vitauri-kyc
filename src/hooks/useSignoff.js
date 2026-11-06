// Shared state for the sign-off steps (Draft Report & QC, Compliance Advice, Final Report & Sign-off).
// Reads the route/permissions from caseSignoffAction (single source of truth) and runs actions through it.
import { useCallback, useEffect, useState } from 'react';
import { base44 } from '@/api/base44Client';
import { toast } from '@/components/ui/use-toast';

const list = (r) => (Array.isArray(r) ? r : r?.items || []);
export const errText = (e) => e?.response?.data?.error || e?.message || 'Something went wrong';

export function useSignoff(kycCase, onCaseUpdate) {
  const [info, setInfo] = useState(null); // { route, perms, advice, qc_passed, incomplete_steps, config }
  const [decisions, setDecisions] = useState([]);
  const [reports, setReports] = useState([]);
  const [busy, setBusy] = useState('');
  const caseId = kycCase?.id;

  const reload = useCallback(async () => {
    if (!caseId) return;
    try {
      const [r, d, rep, fresh] = await Promise.all([
        base44.functions.invoke('caseSignoffAction', { case_id: caseId, action: 'route' }),
        base44.entities.SignOffDecision.filter({ case_id: caseId }, '-created_date', 20).then(list).catch(() => []),
        base44.entities.KycReport.filter({ case_id: caseId }, '-version_number', 30).then(list).catch(() => []),
        base44.entities.KycCase.filter({ id: caseId }).then(list).catch(() => []),
      ]);
      setInfo(r?.data || null);
      setDecisions(d);
      setReports(rep);
      if (fresh[0]) onCaseUpdate?.(fresh[0]);
    } catch (e) {
      toast({ variant: 'destructive', title: 'Could not load the sign-off state', description: errText(e) });
    }
  }, [caseId]);

  useEffect(() => { reload(); }, [reload]);

  /** Runs an action; returns the response data or null on error (a toast is shown). */
  const act = useCallback(async (action, payload = {}, okText) => {
    setBusy(action);
    try {
      const res = await base44.functions.invoke('caseSignoffAction', { case_id: caseId, action, ...payload });
      const data = res?.data || {};
      if (data.error) throw new Error(data.error);
      if (okText) toast({ title: okText });
      await reload();
      return data;
    } catch (e) {
      toast({ variant: 'destructive', title: 'Not done', description: errText(e) });
      return null;
    } finally {
      setBusy('');
    }
  }, [caseId, reload]);

  return { info, route: info?.route, perms: info?.perms || {}, advice: info?.advice || null, decisions, reports, busy, act, reload };
}

/** Label of a report version for the current phase (spec §7). */
export function reportPhaseLabel(kycCase, advice) {
  const s = kycCase?.signoff_status;
  if (s === 'approved') return 'FINAL';
  if (s === 'declined') return 'FINAL · DECLINED';
  if (s === 'terminated') return 'FINAL · TERMINATED';
  if (advice?.status === 'received') return 'DRAFT INCL. COMPLIANCE ADVICE';
  return 'DRAFT';
}
