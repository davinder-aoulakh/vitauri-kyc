// QC state for "Draft Report & QC": latest run, findings, human actions (runCaseQc). Polls while a round is running.
import { useCallback, useEffect, useRef, useState } from 'react';
import { base44 } from '@/api/base44Client';
import { toast } from '@/components/ui/use-toast';
import { errText } from '@/hooks/useSignoff';

export function useQc(caseId, onChanged) {
  const [qc, setQc] = useState(null);
  const [busy, setBusy] = useState('');
  const timer = useRef(null);

  const load = useCallback(async () => {
    if (!caseId) return null;
    try {
      const res = await base44.functions.invoke('runCaseQc', { case_id: caseId, action: 'status' });
      setQc(res?.data || null);
      return res?.data || null;
    } catch (e) {
      toast({ variant: 'destructive', title: 'Could not load QC', description: errText(e) });
      return null;
    }
  }, [caseId]);

  useEffect(() => { load(); }, [load]);

  // Poll every 4 s while running; tell the parent when the round finishes.
  useEffect(() => {
    clearTimeout(timer.current);
    if (qc?.run?.result === 'running') {
      timer.current = setTimeout(async () => {
        const next = await load();
        if (next?.run?.result !== 'running') onChanged?.();
      }, 4000);
    }
    return () => clearTimeout(timer.current);
  }, [qc, load, onChanged]);

  const act = useCallback(async (action, payload = {}, okText) => {
    setBusy(payload.finding_id ? `${action}:${payload.finding_id}` : action);
    try {
      const res = await base44.functions.invoke('runCaseQc', { case_id: caseId, action, ...payload });
      if (res?.data?.error) throw new Error(res.data.error);
      if (okText) toast({ title: okText });
      await load();
      onChanged?.();
      return res?.data || {};
    } catch (e) {
      toast({ variant: 'destructive', title: 'Not done', description: errText(e) });
      return null;
    } finally {
      setBusy('');
    }
  }, [caseId, load, onChanged]);

  return { qc, busy, act, reload: load };
}
