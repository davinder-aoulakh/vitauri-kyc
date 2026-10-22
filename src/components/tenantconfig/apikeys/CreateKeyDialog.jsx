import React, { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Loader2 } from 'lucide-react';

export default function CreateKeyDialog({ open, onOpenChange, onCreate }) {
  const [label, setLabel] = useState('');
  const [tmToken, setTmToken] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await onCreate(label.trim(), tmToken ? ['ingest:write', 'tm:token'] : undefined);
      setLabel('');
      setTmToken(false);
    } catch (err) {
      setError(err?.response?.data?.error || err.message || 'Could not create key');
    }
    setBusy(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <form onSubmit={submit} className="space-y-4">
          <DialogHeader><DialogTitle>Create API key</DialogTitle></DialogHeader>
          <div>
            <Label className="mb-1.5 block text-xs font-medium">Label</Label>
            <Input value={label} onChange={(e) => setLabel(e.target.value)} maxLength={80} placeholder="e.g. Core banking export" className="h-9 text-sm" autoFocus />
            {error && <p className="mt-1.5 text-xs text-destructive">{error}</p>}
          </div>
          <label className="flex items-start gap-2 text-xs">
            <input type="checkbox" checked={tmToken} onChange={(e) => setTmToken(e.target.checked)} className="mt-0.5" />
            <span>Also allow Didit device tokens and event ingest (<span className="font-mono">tm:token</span>)</span>
          </label>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={busy || !label.trim()} className="gap-2">
              {busy && <Loader2 className="h-4 w-4 animate-spin" />}Create key
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}