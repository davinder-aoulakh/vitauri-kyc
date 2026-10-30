import React, { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Loader2, ShieldCheck } from 'lucide-react';

/** ID&V result of an outreach item; it may be stored on the item or inside response_text JSON. */
export function itemIdvStatus(item) {
  if (item?.idv_status) return item.idv_status;
  if (item?.response_text && item.response_text.trim().startsWith('{')) {
    try { return JSON.parse(item.response_text)?.idv_status || null; } catch { return null; }
  }
  return null;
}

const isIdv = (item) => item?.field_type === 'id_verification' || !!item?.didit_session_id;

/**
 * Splits the received items of a request (only those the caller shows) into the ones that can be verified in bulk
 * and ID&V items that still need an individual look (result other than Pass).
 * isVisible(item) mirrors the tracker's own filter. Returns { eligible: [index], held: [{ index, reason }] }.
 */
export function bulkVerifyCandidates(req, isVisible) {
  const eligible = [];
  const held = [];
  (req?.items || []).forEach((item, i) => {
    if (item.status !== 'Received' || !isVisible(item)) return;
    if (isIdv(item)) {
      const s = itemIdvStatus(item);
      if (s !== 'Pass') { held.push({ index: i, reason: s ? `ID&V result: ${s}` : 'ID&V not completed' }); return; }
    }
    eligible.push(i);
  });
  return { eligible, held };
}

function summary(item) {
  if (isIdv(item)) return `ID&V ${itemIdvStatus(item) || 'pending'}`;
  if (item.file_url) return 'File uploaded';
  const t = String(item.response_text || '').trim();
  if (!t || t.startsWith('{')) return '—';
  return t.length > 90 ? `${t.slice(0, 87)}…` : t;
}

/** Confirm "Verify all": every eligible item pre-ticked; the reviewer can untick any before verifying. */
export default function BulkVerifyDialog({ req, candidates, open, onOpenChange, onConfirm, busy }) {
  const [picked, setPicked] = useState(new Set());
  useEffect(() => { if (open) setPicked(new Set(candidates?.eligible || [])); }, [open, candidates]);
  if (!req || !candidates) return null;
  const items = req.items || [];
  const toggle = (i) => setPicked((prev) => { const n = new Set(prev); if (n.has(i)) n.delete(i); else n.add(i); return n; });
  const all = picked.size === candidates.eligible.length;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Verify received items</DialogTitle>
          <DialogDescription>
            Confirm that you reviewed these answers and documents. Each item is marked Verified and recorded in the audit trail under your name.
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-center justify-between text-xs">
          <span className="text-muted-foreground">{picked.size} of {candidates.eligible.length} selected</span>
          <button type="button" className="text-primary hover:underline"
            onClick={() => setPicked(all ? new Set() : new Set(candidates.eligible))}>
            {all ? 'Clear all' : 'Select all'}
          </button>
        </div>
        <ul className="max-h-80 overflow-y-auto divide-y divide-border rounded-lg border border-border">
          {candidates.eligible.map((i) => (
            <li key={i}>
              <label className="flex items-start gap-2.5 px-3 py-2 cursor-pointer hover:bg-muted/40">
                <Checkbox checked={picked.has(i)} onCheckedChange={() => toggle(i)} className="mt-0.5" aria-label={`Verify ${items[i]?.label}`} />
                <span className="min-w-0">
                  <span className="block text-xs font-medium text-foreground">{items[i]?.label}</span>
                  <span className="block text-[11px] text-muted-foreground truncate">{summary(items[i] || {})}</span>
                </span>
              </label>
            </li>
          ))}
        </ul>

        {candidates.held.length > 0 && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-100">
            <p className="font-medium">Not included: verify these one by one after review</p>
            <ul className="mt-1 space-y-0.5">
              {candidates.held.map(({ index, reason }) => <li key={index}>{items[index]?.label} — {reason}</li>)}
            </ul>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)} disabled={busy}>Cancel</Button>
          <Button size="sm" className="gap-1.5" disabled={!picked.size || busy} onClick={() => onConfirm([...picked].sort((a, b) => a - b))}>
            {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ShieldCheck className="w-3.5 h-3.5" />}
            Verify {picked.size} item{picked.size === 1 ? '' : 's'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
