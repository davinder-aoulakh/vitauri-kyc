import React from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';

const COPY = {
  CW: { title: 'Curaçao objective indicators', description: 'Scenarios for FIU Curaçao. Pick one to start a rule from it.' },
  NL: { title: 'Wwft indicators', description: 'Scenarios for FIU-Nederland. Pick one to start a rule from it.' },
};

export default function LibraryDialog({ code, scenarios, onOpenChange, onPick }) {
  const list = (scenarios || [])
    .filter((s) => s.jurisdiction === code || s.jurisdiction === 'ALL' || !s.jurisdiction)
    .sort((a, b) => (a.indicator_type === 'objective' ? 0 : 1) - (b.indicator_type === 'objective' ? 0 : 1) || String(a.code).localeCompare(String(b.code)));
  return (
    <Dialog open={!!code} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>{COPY[code]?.title}</DialogTitle>
          <DialogDescription>{COPY[code]?.description}</DialogDescription>
        </DialogHeader>
        <ul className="divide-y divide-border max-h-96 overflow-y-auto">
          {list.length === 0 && <li className="py-6 text-sm text-muted-foreground text-center">No scenarios in the library yet.</li>}
          {list.map((s) => (
            <li key={s.id} className="py-2.5 flex items-center gap-3">
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium">{s.code} · {s.name}</div>
                <div className="text-xs text-muted-foreground capitalize">{s.indicator_type || 'unclassified'} · {s.jurisdiction || 'ALL'}</div>
              </div>
              <Button size="sm" variant="outline" onClick={() => onPick(s)}>Start rule</Button>
            </li>
          ))}
        </ul>
      </DialogContent>
    </Dialog>
  );
}