import React, { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Loader2 } from 'lucide-react';
import { DECISION_CONFIG } from '@/lib/tmCase';

export default function DecisionDialog({ type, onClose, run }) {
  const [outcome, setOutcome] = useState('');
  const [rationale, setRationale] = useState('');
  const [busy, setBusy] = useState(false);
  const cfg = DECISION_CONFIG[type];

  const submit = async () => {
    setBusy(true);
    const res = type === 'report_decision'
      ? await run('co_decide', { decision: outcome, rationale }, { success: 'Decision recorded' })
      : await run('record_decision', { decision_type: type, outcome, rationale }, { success: `${cfg.label} recorded` });
    setBusy(false);
    if (res) onClose();
  };

  return (
    <Dialog open={!!type} onOpenChange={(v) => !v && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{cfg?.label}</DialogTitle>
          <DialogDescription>This is its own decision. It is recorded separately and does not imply any other decision on the case.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label className="text-xs">Outcome</Label>
            <Select value={outcome} onValueChange={setOutcome}>
              <SelectTrigger className="h-9"><SelectValue placeholder="Choose an outcome" /></SelectTrigger>
              <SelectContent>{cfg?.outcomes.map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Rationale (required)</Label>
            <Textarea value={rationale} onChange={(e) => setRationale(e.target.value)} className="min-h-24 text-sm" placeholder="Explain the decision and the evidence it rests on" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={submit} disabled={busy || !outcome || !rationale.trim()}>{busy && <Loader2 className="w-4 h-4 animate-spin" />} Record decision</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}