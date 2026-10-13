import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Loader2, ArrowUpRight } from 'lucide-react';
import DecisionDialog from '@/components/tm/case/DecisionDialog';
import { DECISION_CONFIG, OUTCOME_LABEL } from '@/lib/tmCase';

const TYPES = ['kyc_approval', 'aml_assessment', 'payment_release'];

export default function DecisionsPanel({ tmCase, decisions, users, currentUserId, canWork, isCO, run, busy }) {
  const [type, setType] = useState('');
  const latest = (t) => decisions.find((d) => d.decision_type === t);
  const who = (id) => users.find((u) => u.id === id)?.full_name || 'Unknown';
  const open = ['open', 'investigating', 'pending_co'].includes(tmCase.status);
  const isAssignee = currentUserId === tmCase.assigned_to_user_id;
  const canEscalate = canWork && ['open', 'investigating'].includes(tmCase.status) && isAssignee;
  const coBlocked = isAssignee ? 'Four-eyes: you are the assigned investigator, so another Compliance Officer must decide.' : '';

  return (
    <section className="bg-card border border-border rounded-xl p-5 space-y-4">
      <h2 className="text-sm font-semibold">Decisions</h2>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
        {TYPES.map((t) => (
          <Button key={t} variant="outline" size="sm" disabled={!canWork || tmCase.status === 'closed'} onClick={() => setType(t)}>{DECISION_CONFIG[t].label}</Button>
        ))}
      </div>
      <ul className="space-y-1.5 text-xs">
        {[...TYPES, 'report_decision'].map((t) => {
          const d = latest(t);
          return (
            <li key={t} className="flex justify-between gap-2">
              <span className="text-muted-foreground">{DECISION_CONFIG[t].label}</span>
              <span className="text-foreground text-right">{d ? `${OUTCOME_LABEL[d.outcome] || d.outcome} · ${who(d.decided_by_user_id)}` : 'Not recorded'}</span>
            </li>
          );
        })}
      </ul>
      {canEscalate && (
        <Button size="sm" className="w-full gap-1.5" disabled={!!busy} onClick={() => run('escalate_to_co', {}, { success: 'Escalated to Compliance Officers' })}>
          {busy === 'escalate_to_co' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ArrowUpRight className="w-3.5 h-3.5" />} Escalate to Compliance Officer
        </Button>
      )}
      {isCO && tmCase.status === 'pending_co' && (
        <div className="border-t border-border pt-3 space-y-2">
          <div className="text-xs font-semibold">Compliance Officer decision</div>
          <Button size="sm" variant="outline" className="w-full" disabled={!!coBlocked} onClick={() => setType('report_decision')}>Decide: report / no report</Button>
          {coBlocked && <p className="text-xs text-amber-700">{coBlocked}</p>}
        </div>
      )}
      {!open && tmCase.co_decision && <p className="text-xs text-muted-foreground">Decided on {new Date(tmCase.co_decided_at).toLocaleDateString()}: {tmCase.co_rationale}</p>}
      {type && <DecisionDialog type={type} onClose={() => setType('')} run={run} />}
      <p className="text-xs text-muted-foreground bg-muted/40 rounded-lg p-3">
        Separate decisions: a successful identity re-verification does not explain where the money came from. Customer requests are locked once an FIU report is being prepared.
      </p>
    </section>
  );
}