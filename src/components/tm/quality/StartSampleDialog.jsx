import React, { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Loader2 } from 'lucide-react';

const COPY = {
  below_the_line: { title: 'New below-the-line sample', hint: 'A random sample of transactions that produced no alert.', size: 400 },
  file_review: { title: 'New file review', hint: 'A random sample of closed alerts. You cannot review alerts you closed yourself.', size: 30 },
};

export default function StartSampleDialog({ type, period, busy, onOpenChange, onStart }) {
  const [size, setSize] = useState('');
  useEffect(() => { setSize(type ? String(COPY[type].size) : ''); }, [type]);
  if (!type) return null;
  const n = Number(size);
  const ok = Number.isInteger(n) && n >= 1 && n <= 1000;
  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{COPY[type].title}</DialogTitle>
          <DialogDescription>{COPY[type].hint} Period: {period.from} to {period.to}.</DialogDescription>
        </DialogHeader>
        <div>
          <Label className="text-xs">Sample size (1 to 1000)</Label>
          <Input type="number" min={1} max={1000} value={size} onChange={(e) => setSize(e.target.value)} />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button disabled={!ok || !!busy} onClick={() => onStart(n)}>{busy && <Loader2 className="w-4 h-4 animate-spin" />} Start sample</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}