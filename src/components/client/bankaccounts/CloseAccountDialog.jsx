import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import InlineError from '@/components/shared/InlineError';
import { Loader2 } from 'lucide-react';

/** Close an account. Mount with a key per account. */
export default function CloseAccountDialog({ account, onOpenChange, onDone }) {
  const [closedAt, setClosedAt] = useState(new Date().toISOString().slice(0, 10));
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async () => {
    setBusy(true); setError('');
    try {
      await base44.functions.invoke('manageBankAccount', { action: 'close', id: account.id, closed_at: closedAt, reason });
      onDone();
      onOpenChange(false);
    } catch (e) {
      setError(e?.response?.data?.error || e?.message || 'Could not close the account.');
    } finally { setBusy(false); }
  };

  return (
    <Dialog open={!!account} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>Close {account?.iban_or_number}</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div><Label className="text-xs mb-1 block">Closed on</Label><Input type="date" value={closedAt} onChange={(e) => setClosedAt(e.target.value)} /></div>
          <div><Label className="text-xs mb-1 block">Reason</Label><Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} /></div>
          <p className="text-xs text-muted-foreground">Days after the closing date will no longer be expected in coverage.</p>
        </div>
        {error && <InlineError message={error} />}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>Cancel</Button>
          <Button onClick={submit} disabled={busy || !reason.trim() || !closedAt} className="gap-2">
            {busy && <Loader2 className="h-4 w-4 animate-spin" />} Close account
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}