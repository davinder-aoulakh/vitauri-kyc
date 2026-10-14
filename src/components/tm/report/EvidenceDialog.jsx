import React, { useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import InlineError from '@/components/shared/InlineError';
import { SUBMISSION_METHODS, uploadEvidence } from '@/lib/fiuReport';
import { errorMessage } from '@/lib/tmAlerts';
import { Loader2 } from 'lucide-react';

const nowLocal = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16);

/** mode 'submitted': method + time + required evidence. mode 'received': FIU reference + time + optional evidence. (Files stored privately.) */
export default function EvidenceDialog({ open, onOpenChange, mode, busy, onSubmit }) {
  const submitted = mode === 'submitted';
  const [method, setMethod] = useState('portal_upload');
  const [reference, setReference] = useState('');
  const [at, setAt] = useState(nowLocal());
  const [file, setFile] = useState(null);
  const [error, setError] = useState('');
  const [uploading, setUploading] = useState(false);
  const ready = submitted ? !!file : !!reference.trim();

  const submit = async () => {
    setError(''); setUploading(true);
    try {
      const evidence_file = file ? await uploadEvidence(file) : undefined;
      const payload = submitted ? { method, at: new Date(at).toISOString(), evidence_file } : { fiu_reference: reference.trim(), at: new Date(at).toISOString(), evidence_file };
      if (await onSubmit(payload)) onOpenChange(false);
    } catch (e) { setError(errorMessage(e)); } finally { setUploading(false); }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{submitted ? 'Record submission' : 'Record receipt'}</DialogTitle>
          <DialogDescription>{submitted ? 'The report only counts as submitted with that evidence.' : 'Enter the reference the FIU gave. Evidence is optional.'}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          {submitted ? (
            <div><Label>Method</Label>
              <Select value={method} onValueChange={setMethod}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{SUBMISSION_METHODS.map((m) => <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          ) : (
            <div><Label>FIU reference</Label><Input value={reference} onChange={(e) => setReference(e.target.value)} /></div>
          )}
          <div><Label>{submitted ? 'Submitted at' : 'Received at'}</Label><Input type="datetime-local" value={at} max={nowLocal()} onChange={(e) => setAt(e.target.value)} /></div>
          <div><Label>{submitted ? 'Evidence (required)' : 'Evidence (optional)'}</Label><Input type="file" onChange={(e) => setFile(e.target.files?.[0] || null)} /></div>
          {error && <InlineError message={error} />}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button disabled={busy || uploading || !ready || !at} onClick={submit}>{(busy || uploading) && <Loader2 className="w-4 h-4 animate-spin" />} Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}