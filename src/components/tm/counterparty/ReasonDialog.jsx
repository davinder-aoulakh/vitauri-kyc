import React, { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import InlineError from '@/components/shared/InlineError';
import { Loader2 } from 'lucide-react';
import { errText } from '@/lib/tmCounterparty';

/** Confirm an action with a required reason. onConfirm(reason) may throw. Mount only while open. */
export default function ReasonDialog({ title, description, confirmLabel, onConfirm, onOpenChange }) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async () => {
    setBusy(true); setError('');
    try { await onConfirm(reason.trim()); onOpenChange(false); } catch (e) { setError(errText(e, 'Action failed.')); } finally { setBusy(false); }
  };

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>{title}</DialogTitle></DialogHeader>
        {description && <p className="text-sm text-muted-foreground">{description}</p>}
        <Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} placeholder="Reason (required)" />
        {error && <InlineError message={error} />}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>Cancel</Button>
          <Button onClick={submit} disabled={busy || !reason.trim()} className="gap-2">{busy && <Loader2 className="h-4 w-4 animate-spin" />} {confirmLabel}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}