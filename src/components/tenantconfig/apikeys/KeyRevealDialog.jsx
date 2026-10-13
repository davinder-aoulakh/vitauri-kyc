import React, { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { AlertTriangle, Copy, Check } from 'lucide-react';

export default function KeyRevealDialog({ plaintextKey, onClose }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    await navigator.clipboard.writeText(plaintextKey);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <Dialog open={!!plaintextKey} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-lg" onInteractOutside={(e) => e.preventDefault()}>
        <DialogHeader>
          <DialogTitle>Your new API key</DialogTitle>
          <DialogDescription>Use it as a Bearer token when calling the ingest endpoint.</DialogDescription>
        </DialogHeader>
        <div className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs text-amber-800">
          <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" />
          <span><strong>Copy it now.</strong> This key is shown only once and cannot be retrieved later. If you lose it, revoke it and create a new one.</span>
        </div>
        <div className="flex items-center gap-2">
          <code className="flex-1 break-all rounded-lg border border-border bg-muted px-3 py-2 font-mono text-xs">{plaintextKey}</code>
          <Button size="sm" variant="outline" onClick={copy} className="gap-1.5">
            {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}{copied ? 'Copied' : 'Copy'}
          </Button>
        </div>
        <DialogFooter><Button onClick={onClose}>I have saved the key</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}