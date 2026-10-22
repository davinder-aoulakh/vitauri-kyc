import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import { useTenant } from '@/lib/tenantContext';
import { hasPermission } from '@/lib/permissions';
import { toast } from '@/components/ui/use-toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Loader2 } from 'lucide-react';

const errText = (e) => e?.response?.data?.error || e?.message || 'Something went wrong';

/** Accept / Dismiss for a proposed EdrTrigger (tmWorkCase). Accept opens the new event-driven review. */
export default function EdrTriggerActions({ trigger, onDone }) {
  const { currentUser } = useTenant();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(null);
  const [dismissing, setDismissing] = useState(false);
  const [reason, setReason] = useState('');
  if (!hasPermission(currentUser?.app_role, 'tmWorkCase')) return null;

  const run = async (action) => {
    setBusy(action);
    try {
      const res = await base44.functions.invoke('decideEdrTrigger', { edr_trigger_id: trigger.id, action, ...(action === 'dismiss' ? { dismiss_reason: reason } : {}) });
      if (res?.data?.error) throw new Error(res.data.error);
      toast({ title: action === 'accept' ? 'Event-driven review opened' : 'Proposal dismissed' });
      onDone?.();
      if (action === 'accept' && res?.data?.kyc_case_id) navigate(`/case/${res.data.kyc_case_id}`);
    } catch (e) {
      toast({ title: action === 'accept' ? 'Could not open the review' : 'Could not dismiss', description: errText(e), variant: 'destructive' });
    } finally {
      setBusy(null);
    }
  };

  if (dismissing) {
    return (
      <div className="flex items-center gap-1.5" onClick={(e) => e.preventDefault()}>
        <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason for dismissing…" className="h-7 text-xs w-48" autoFocus />
        <Button size="sm" variant="outline" className="h-7 text-xs" disabled={!!busy || reason.trim().length < 5} onClick={() => run('dismiss')}>
          {busy === 'dismiss' && <Loader2 className="w-3 h-3 animate-spin" />} Dismiss
        </Button>
        <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => { setDismissing(false); setReason(''); }}>Cancel</Button>
      </div>
    );
  }
  return (
    <div className="flex items-center gap-1.5" onClick={(e) => e.preventDefault()}>
      <Button size="sm" className="h-7 text-xs" disabled={!!busy} onClick={() => run('accept')}>
        {busy === 'accept' && <Loader2 className="w-3 h-3 animate-spin" />} Accept
      </Button>
      <Button size="sm" variant="outline" className="h-7 text-xs" disabled={!!busy} onClick={() => setDismissing(true)}>Dismiss</Button>
    </div>
  );
}
