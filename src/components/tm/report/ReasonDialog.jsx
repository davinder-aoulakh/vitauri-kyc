import React, { useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Loader2 } from 'lucide-react';

/** Asks for a free-text reason (min 5 chars). Used for sending back, FIU rejection, lateness and approval notes. */
export default function ReasonDialog({ open, onOpenChange, title, description, label, confirmLabel, required = true, busy, onSubmit }) {
  const [text, setText] = useState('');
  const ok = !required || text.trim().length >= 5;
  const submit = async () => { if (await onSubmit(text.trim())) { setText(''); onOpenChange(false); } };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>
        <Textarea value={text} onChange={(e) => setText(e.target.value)} placeholder={label} aria-label={label} className="min-h-24" />
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button disabled={busy || !ok} onClick={submit}>{busy && <Loader2 className="w-4 h-4 animate-spin" />} {confirmLabel}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}