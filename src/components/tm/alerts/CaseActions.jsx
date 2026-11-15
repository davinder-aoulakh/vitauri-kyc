import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { FolderPlus, FolderInput, Loader2 } from 'lucide-react';
import { Link } from 'react-router-dom';
import InlineError from '@/components/shared/InlineError';
import CreateCaseDialog from '@/components/tm/case/CreateCaseDialog';
import { errorMessage } from '@/lib/tmAlerts';
import { useTenant } from '@/lib/tenantContext';
import { amlLayoutOn } from '@/lib/amlNav';
import { toast } from '@/components/ui/use-toast';

const OPEN_CASE = ['open', 'investigating', 'pending_co'];

export default function CaseActions({ alert, tenantId, onChanged }) {
  const [adding, setAdding] = useState(false);
  const [creating, setCreating] = useState(false);
  const [caseId, setCaseId] = useState('');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const { tenant } = useTenant();
  const v2 = amlLayoutOn(tenant);

  const { data: cases = [] } = useQuery({
    queryKey: ['tmOpenCases', tenantId],
    enabled: adding && !!tenantId,
    queryFn: async () => (await base44.entities.TmCase.filter({ tenant_id: tenantId, status: { $in: OPEN_CASE } }, { sort: '-created_date', limit: 100 })).items || [],
  });

  const run = async (action, extra = {}) => {
    setBusy(action);
    setError('');
    try {
      const res = await base44.functions.invoke('tmAlertActions', { alert_id: alert.id, action, ...extra });
      if (action === 'escalate' && res?.data?.case_ref) {
        toast({ title: res.data.created ? `Investigation ${res.data.case_ref} started` : `Added to investigation ${res.data.case_ref}` });
      }
      setAdding(false);
      onChanged?.();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy('');
    }
  };

  if (alert.tm_case_id) {
    return <Link to={`/tm/case/${alert.tm_case_id}`} className="text-xs text-primary hover:underline">{v2 ? 'Linked to an investigation. Open investigation' : 'Linked to a TM case. Open case'}</Link>;
  }

  // New layout: one Escalate button. The alert joins the customer's open investigation or starts one (tenant setting).
  if (v2) {
    return (
      <div className="space-y-2">
        <Button size="sm" className="gap-1.5" disabled={!!busy} onClick={() => run('escalate')}>
          {busy === 'escalate' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <FolderInput className="w-3.5 h-3.5" />} Escalate to investigation
        </Button>
        <p className="text-xs text-muted-foreground">Adds this alert to the open investigation it belongs to, or starts a new one.</p>
        {error && <InlineError message={error} />}
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="outline" className="gap-1.5" disabled={!!busy} onClick={() => setCreating(true)}>
          <FolderPlus className="w-3.5 h-3.5" /> Create case
        </Button>
        <Button size="sm" variant="outline" className="gap-1.5" disabled={!!busy} onClick={() => setAdding((v) => !v)}>
          <FolderInput className="w-3.5 h-3.5" /> Add to case
        </Button>
      </div>
      {adding && (
        <div className="flex gap-2">
          <Select value={caseId} onValueChange={setCaseId}>
            <SelectTrigger className="h-9 flex-1"><SelectValue placeholder={cases.length ? 'Choose an open case' : 'No open cases'} /></SelectTrigger>
            <SelectContent>
              {cases.map((c) => <SelectItem key={c.id} value={c.id}>{c.case_ref || c.id.slice(-6)} · {c.title || 'Untitled'}</SelectItem>)}
            </SelectContent>
          </Select>
          <Button size="sm" disabled={!caseId || !!busy} onClick={() => run('add_to_case', { tm_case_id: caseId })}>
            {busy === 'add_to_case' && <Loader2 className="w-3.5 h-3.5 animate-spin" />} Add
          </Button>
        </div>
      )}
      {error && <InlineError message={error} />}
      {creating && (
        <CreateCaseDialog open alertIds={[alert.id]} defaultTitle={alert.title} onOpenChange={(v) => !v && setCreating(false)} onCreated={onChanged} />
      )}
    </div>
  );
}