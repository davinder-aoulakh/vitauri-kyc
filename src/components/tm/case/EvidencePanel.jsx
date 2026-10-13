import React from 'react';
import { Button } from '@/components/ui/button';
import { Loader2, Sparkles } from 'lucide-react';
import EvidenceItem from '@/components/tm/case/EvidenceItem';

const OPEN = ['open', 'investigating', 'pending_co'];

export default function EvidencePanel({ tmCase, canWork, run, busy }) {
  const evidence = tmCase.evidence || [];
  const canEdit = canWork && OPEN.includes(tmCase.status);
  const accept = (id) => run('accept_evidence', { evidence_id: id }, { success: 'Evidence accepted' });
  const edit = async (id, text) => !!(await run('edit_evidence', { evidence_id: id, text }, { success: 'Evidence updated' }));

  return (
    <section className="bg-card border border-border rounded-xl p-5">
      <div className="flex items-center justify-between gap-2 mb-2">
        <h2 className="text-sm font-semibold flex items-center gap-1.5"><Sparkles className="w-4 h-4 text-purple-600" /> Evidence collected by AI</h2>
        {canEdit && (
          <Button size="sm" variant="outline" className="h-8 text-xs gap-1.5" disabled={!!busy} onClick={() => run('collect_evidence', {}, { success: 'Evidence collected', fail: 'Could not collect evidence' })}>
            {busy === 'collect_evidence' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
            {evidence.length ? 'Collect again' : 'Collect evidence'}
          </Button>
        )}
      </div>
      {busy === 'collect_evidence' && <p className="text-xs text-muted-foreground mb-2">Reading alerts, transactions, KYC file, screening and coverage. This can take up to a minute.</p>}
      {evidence.length === 0 ? (
        <p className="text-sm text-muted-foreground py-6 text-center">No evidence yet. Use “Collect evidence” to have AI propose sourced findings. Nothing counts until you accept it.</p>
      ) : (
        <ul>
          {evidence.map((e) => <EvidenceItem key={e.id} item={e} canEdit={canEdit} busy={!!busy} onAccept={accept} onSave={edit} />)}
        </ul>
      )}
      <p className="text-[11px] text-muted-foreground mt-3">! risk · ✓ ok · ? unclear · – data gap. AI proposals are never accepted automatically.</p>
    </section>
  );
}