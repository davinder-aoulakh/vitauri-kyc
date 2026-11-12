import React, { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Loader2, ShieldCheck, XCircle } from 'lucide-react';
import { AiCheckPanel } from '@/components/documents/AiDocCheck';

/**
 * Review of a document the AI Document Checker flagged, inside the Outreach step (no trip to the Documents tab).
 * Approve verifies the outreach item and approves the document; a high-risk document needs a reason (recorded as an override).
 * Reject marks the document Rejected; the outreach item stays unverified so a new document can be requested.
 */
export default function DocReviewDialog({ open, onOpenChange, doc, client, itemLabel, busy, running, onRecheck, onApprove, onReject }) {
  const [reason, setReason] = useState('');
  useEffect(() => { if (open) setReason(''); }, [open, doc?.id]);
  if (!doc) return null;
  const high = doc.ai_check?.verdict === 'high_risk';
  const min = 10;
  const okApprove = !high || reason.trim().length >= min;
  const okReject = reason.trim().length >= min;
  return (
    <Dialog open={open} onOpenChange={(v) => { if (!busy) onOpenChange(v); }}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader><DialogTitle className="text-base">Review document: {itemLabel || doc.file_name}</DialogTitle></DialogHeader>
        <p className="text-xs text-muted-foreground">
          The AI Document Checker rated this document {high ? 'high risk' : 'as needing attention'}. Check the points below, then approve or reject it here.
        </p>
        <AiCheckPanel doc={doc} client={client} running={running} onRecheck={onRecheck} />
        <div className="space-y-1">
          <label htmlFor="doc-review-reason" className="text-xs font-medium">
            {high ? 'Reason (required to approve a high-risk document, and to reject)' : 'Note (optional to approve, required to reject)'}
          </label>
          <Textarea id="doc-review-reason" value={reason} onChange={(e) => setReason(e.target.value)} className="min-h-20 text-sm"
            placeholder={high ? 'Why is this document acceptable despite the high-risk rating?' : 'Optional note for the file'} />
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="outline" className="gap-1.5 border-red-300 text-red-700 hover:bg-red-50" disabled={!!busy || !okReject} onClick={() => onReject(reason.trim())}>
            <XCircle className="h-4 w-4" /> Reject document
          </Button>
          <Button className="gap-1.5 bg-emerald-600 text-white hover:bg-emerald-700" disabled={!!busy || !okApprove} onClick={() => onApprove(reason.trim())}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />} Approve &amp; verify
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
