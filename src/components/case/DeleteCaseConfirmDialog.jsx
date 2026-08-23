import React, { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Trash2, Loader2 } from 'lucide-react';

export default function DeleteCaseConfirmDialog({ kycCase, clientName, open, onClose, onConfirm }) {
  const [confirmText, setConfirmText] = useState('');
  const [deleting, setDeleting] = useState(false);

  async function handleConfirm() {
    if (confirmText !== 'DELETE') return;
    setDeleting(true);
    await onConfirm();
    setDeleting(false);
    setConfirmText('');
  }

  function handleClose() {
    if (deleting) return;
    setConfirmText('');
    onClose();
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-destructive">
            <Trash2 className="w-5 h-5" /> Permanently Delete Case
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm space-y-1">
            <p className="font-semibold text-red-800">{clientName || 'Unknown Client'}</p>
            <p className="text-xs text-red-600">
              Case type: <strong>{kycCase?.case_type?.replace(/_/g, ' ')}</strong> · Status: <strong>{kycCase?.status}</strong>
            </p>
            <p className="text-xs text-red-700 mt-2">
              This will permanently delete the case and all related records (Screening Hits, Control Measures, Reports, Outreach Requests).
              Documents remain on the client record. <strong>This action cannot be undone.</strong>
            </p>
          </div>
          <div>
            <label className="text-xs font-medium block mb-1.5">Type <strong>DELETE</strong> to confirm</label>
            <Input
              value={confirmText}
              onChange={e => setConfirmText(e.target.value)}
              placeholder="DELETE"
              className="font-mono text-sm"
              disabled={deleting}
            />
          </div>
          <div className="flex gap-2 justify-end">
            <Button variant="outline" onClick={handleClose} disabled={deleting}>Cancel</Button>
            <Button
              variant="destructive"
              disabled={confirmText !== 'DELETE' || deleting}
              onClick={handleConfirm}
            >
              {deleting && <Loader2 className="w-4 h-4 animate-spin mr-1" />}
              Permanently Delete
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}