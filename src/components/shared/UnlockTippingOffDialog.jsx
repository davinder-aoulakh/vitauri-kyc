import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { useToast } from '@/components/ui/use-toast';
import { errorMessage } from '@/lib/tmAlerts';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import InlineError from '@/components/shared/InlineError';
import { Loader2 } from 'lucide-react';

export default function UnlockTippingOffDialog({ open, onOpenChange, clientId, onUnlocked }) {
  const { toast } = useToast();
  const [rationale, setRationale] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async () => {
    setBusy(true); setError('');
    try {
      await base44.functions.invoke('unlockTippingOff', { client_id: clientId, rationale });
      toast({ title: 'Customer communications unlocked' });
      setRationale('');
      onOpenChange(false);
      onUnlocked?.();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Release customer communications lock</DialogTitle>
          <DialogDescription>Allowed only after the FIU report is received/accepted or a no-report decision was recorded. The release is audited.</DialogDescription>
        </DialogHeader>
        <Textarea value={rationale} onChange={(e) => setRationale(e.target.value)} placeholder="Rationale (required, at least 10 characters)" className="min-h-24" />
        {error && <InlineError message={error} />}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button disabled={busy || rationale.trim().length < 10} onClick={submit}>{busy && <Loader2 className="w-4 h-4 animate-spin" />} Release lock</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}