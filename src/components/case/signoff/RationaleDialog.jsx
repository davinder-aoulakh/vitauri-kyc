import React, { useEffect, useState } from 'react';
import { base44 } from '@/api/base44Client';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { toast } from '@/components/ui/use-toast';
import { errText } from '@/hooks/useSignoff';
import { AlertTriangle, Loader2, Sparkles } from 'lucide-react';

const TITLES = {
  approve: ['Approve the client', 'Your rationale is stored with the decision and printed in the final report.'],
  return: ['Return to Draft Report & QC', 'The report version stays unapproved; the analyst sees your reason.'],
  decline: ['Decline relationship', 'The client is not onboarded. The dossier is frozen and retained.'],
  terminate: ['Terminate relationship', 'The existing relationship ends and an exit flow starts. The dossier is frozen and retained.'],
  escalate: ['Escalate to Senior Management', 'The case moves to Senior Management sign-off.'],
  return_to_analyst: ['Return to the analyst (changes needed)', 'The case goes back to Draft Report & QC with your reason.'],
  reopen: ['Reopen the case', 'A new report version follows; the last approved version stays valid until the new one is signed.'],
};
const REPORTING = [
  ['no_report_required', 'Assessed: no report required'],
  ['report_filed', 'Report filed with the FIU'],
  ['report_to_be_filed', 'Report still to be filed'],
];
const CORE_STEPS = [[1, 'Outreach & Documents'], [2, 'Identity / Entity Verification'], [3, 'Screening'], [4, 'Client / Entity Profile'], [5, 'Source of Funds/Wealth'], [6, 'Risk Assessment'], [7, 'Control Measures']];

/**
 * kind: approve | return | decline | terminate | escalate | return_to_analyst | reopen.
 * onConfirm(payload) -> resolves truthy on success. AI drafting is offered for approve/return/decline/terminate.
 */
export default function RationaleDialog({ open, onOpenChange, kind, caseId, adviceRecommendation, busy, onConfirm }) {
  const [text, setText] = useState('');
  const [aiUsed, setAiUsed] = useState(false);
  const [drafting, setDrafting] = useState(false);
  const [deviates, setDeviates] = useState(false);
  const [reporting, setReporting] = useState('');
  const [letter, setLetter] = useState(true);
  const [scope, setScope] = useState('partial');
  const [steps, setSteps] = useState([]);
  useEffect(() => { if (open) { setText(''); setAiUsed(false); setDeviates(false); setReporting(''); setLetter(true); setScope('partial'); setSteps([]); } }, [open, kind]);

  const [title, desc] = TITLES[kind] || ['Confirm', ''];
  const aiAllowed = ['approve', 'return', 'decline', 'terminate'].includes(kind);
  const isExit = kind === 'decline' || kind === 'terminate';
  const knownDeviation = deviates || (adviceRecommendation && ((kind === 'approve' && adviceRecommendation !== 'Approve') || (isExit && adviceRecommendation === 'Approve')));
  const placeholderLeft = /\[add your reason\]/i.test(text);
  const valid = text.trim().length >= 10 && !placeholderLeft && (!isExit || reporting) && (kind !== 'reopen' || scope === 'full' || steps.length > 0);

  const draft = async () => {
    setDrafting(true);
    try {
      const res = (await base44.functions.invoke('caseSignoffAction', { case_id: caseId, action: 'ai_draft_rationale', decision: kind }))?.data || {};
      if (res.error) throw new Error(res.error);
      setText(res.text || ''); setAiUsed(true); setDeviates(!!res.deviates);
    } catch (e) {
      toast({ variant: 'destructive', title: 'AI draft failed', description: errText(e) });
    } finally { setDrafting(false); }
  };

  const confirm = async () => {
    const payload = kind === 'reopen'
      ? { reason: text.trim(), scope, steps }
      : ['escalate', 'return_to_analyst'].includes(kind) ? { reason: text.trim() }
        : { rationale: text.trim(), rationale_ai_assisted: aiUsed, ...(isExit ? { reporting_obligation: reporting, neutral_letter: letter } : {}) };
    const ok = await onConfirm(payload);
    if (ok) onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{desc}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          {knownDeviation && (
            <div className="flex gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
              <AlertTriangle className="h-4 w-4 flex-shrink-0" />
              <span>This decision deviates from the Compliance advice ({adviceRecommendation}). State the reason in your rationale.</span>
            </div>
          )}
          <div className="flex items-center justify-between">
            <label className="text-xs font-medium" htmlFor="rationale">{kind === 'reopen' || kind === 'escalate' || kind === 'return_to_analyst' ? 'Reason' : 'Rationale'} (required)</label>
            {aiAllowed && (
              <Button type="button" size="sm" variant="outline" className="h-7 gap-1 text-xs" disabled={drafting} onClick={draft}>
                {drafting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />} Draft with AI
              </Button>
            )}
          </div>
          <Textarea id="rationale" value={text} onChange={(e) => setText(e.target.value)} className="min-h-40 resize-y text-sm" placeholder="Write it yourself, or start from an AI draft." />
          {aiUsed && <p className="text-[11px] text-violet-700">AI-assisted draft. Edit it before you confirm. You remain responsible.</p>}
          {placeholderLeft && <p className="text-[11px] text-red-700">Replace “[add your reason]” with your reason.</p>}

          {isExit && (
            <div className="space-y-2 rounded-md border border-border p-3">
              <div className="text-xs font-medium">Reporting-obligation assessment (required)</div>
              {REPORTING.map(([v, l]) => (
                <label key={v} className="flex items-center gap-2 text-xs">
                  <input type="radio" name="reporting" value={v} checked={reporting === v} onChange={() => setReporting(v)} /> {l}
                </label>
              ))}
              <label className="flex items-center gap-2 pt-1 text-xs">
                <Checkbox checked={letter} onCheckedChange={(v) => setLetter(!!v)} /> Send neutral letter to the client (no reason given)
              </label>
            </div>
          )}

          {kind === 'reopen' && (
            <div className="space-y-2 rounded-md border border-border p-3">
              <div className="flex gap-4 text-xs">
                <label className="flex items-center gap-1.5"><input type="radio" checked={scope === 'partial'} onChange={() => setScope('partial')} /> Partial (pick steps)</label>
                <label className="flex items-center gap-1.5"><input type="radio" checked={scope === 'full'} onChange={() => setScope('full')} /> Full (all steps)</label>
              </div>
              {scope === 'partial' && (
                <div className="grid grid-cols-2 gap-1">
                  {CORE_STEPS.map(([id, l]) => (
                    <label key={id} className="flex items-center gap-1.5 text-xs">
                      <Checkbox checked={steps.includes(id)} onCheckedChange={(v) => setSteps((s) => (v ? [...s, id] : s.filter((x) => x !== id)))} /> {l}
                    </label>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button disabled={!valid || !!busy} onClick={confirm} className={isExit ? 'bg-red-600 hover:bg-red-700 text-white' : ''}>
            {busy && <Loader2 className="h-4 w-4 animate-spin" />} Confirm
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
