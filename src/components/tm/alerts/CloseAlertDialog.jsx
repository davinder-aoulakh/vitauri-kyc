import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Loader2 } from 'lucide-react';
import InlineError from '@/components/shared/InlineError';
import { errorMessage } from '@/lib/tmAlerts';

export default function CloseAlertDialog({ alertIds, open, onOpenChange, onClosed }) {
  const [outcome, setOutcome] = useState('closed_false_positive');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const count = alertIds?.length || 0;

  const submit = async () => {
    setBusy(true);
    setError('');
    try {
      await base44.functions.invoke('closeTmAlert', { alert_ids: alertIds, outcome, reason: reason.trim() });
      setReason('');
      onClosed?.();
      onOpenChange(false);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!busy) onOpenChange(v); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{count > 1 ? `Close ${count} alerts` : 'Close alert'}</DialogTitle>
          <DialogDescription>Closing is a human decision and is recorded with your reason.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label>Outcome</Label>
            <Select value={outcome} onValueChange={setOutcome}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="closed_false_positive">False positive</SelectItem>
                <SelectItem value="closed_no_action">No action needed</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Reason (required)</Label>
            <Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={4} placeholder="Why is this alert being closed?" />
          </div>
          {error && <InlineError message={error} />}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>Cancel</Button>
          <Button onClick={submit} disabled={busy || !reason.trim()}>
            {busy && <Loader2 className="w-4 h-4 animate-spin" />} Close alert{count > 1 ? 's' : ''}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}