import React from 'react';
import { PROPOSAL_LABEL } from '@/lib/tmAlerts';
import CounterpartyLink from '@/components/tm/counterparty/CounterpartyLink';

const Section = ({ title, children }) => (
  <section className="space-y-2">
    <h3 className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">{title}</h3>
    {children}
  </section>
);

const fmtAmount = (t) => `${t.direction === 'outbound' ? '−' : '+'}${Number(t.amount || 0).toLocaleString('en-US')} ${t.currency || ''}`;

export default function AlertEvidence({ alert, txns }) {
  const ruleRuns = txns.flatMap((t) => (t.didit_rule_runs || []).map((r) => ({ ...r, txn: t.id })));
  const refs = alert.ai_reason_refs?.length ? alert.ai_reason_refs : (alert.ai_reasons || []).map((text) => ({ text, source_refs: [] }));
  return (
    <div className="space-y-5">
      <Section title="AI proposal">
        {alert.ai_proposal ? (
          <div className="rounded-lg bg-purple-50 dark:bg-purple-500/10 border border-purple-200 dark:border-purple-500/30 p-3 space-y-2">
            <p className="text-sm font-semibold text-purple-900 dark:text-purple-200">{PROPOSAL_LABEL[alert.ai_proposal]}</p>
            <ul className="space-y-1.5">
              {refs.map((r, i) => (
                <li key={i} className="text-xs text-foreground">
                  {r.text}
                  {r.source_refs?.length > 0 && <span className="block text-[11px] text-muted-foreground font-mono">Sources: {r.source_refs.join(', ')}</span>}
                </li>
              ))}
            </ul>
            {alert.ai_missing?.length > 0 && <p className="text-[11px] text-muted-foreground">Missing: {alert.ai_missing.join('; ')}</p>}
            <p className="text-[11px] text-muted-foreground">A proposal only. A person decides.</p>
          </div>
        ) : <p className="text-xs text-muted-foreground">Not triaged yet.</p>}
      </Section>
      <Section title={`Transactions (${txns.length})`}>
        {txns.length === 0 && <p className="text-xs text-muted-foreground">No linked transactions.</p>}
        <ul className="divide-y divide-border border border-border rounded-lg">
          {txns.map((t) => (
            <li key={t.id} className="px-3 py-2 text-xs flex justify-between gap-3">
              <span className="truncate"><CounterpartyLink id={t.counterparty_id}>{t.counterparty_name || 'Unknown counterparty'}</CounterpartyLink> · {String(t.executed_at || '').slice(0, 10)}</span>
              <span className="font-medium tabular-nums">{fmtAmount(t)}</span>
            </li>
          ))}
        </ul>
      </Section>
      <Section title="Rule runs">
        {ruleRuns.length === 0 && <p className="text-xs text-muted-foreground">No rule runs recorded.</p>}
        <ul className="space-y-1">
          {ruleRuns.map((r, i) => (
            <li key={i} className="text-xs flex justify-between gap-3 bg-secondary/60 rounded px-2.5 py-1.5">
              <span className="truncate">{r.rule_name || r.name || r.rule_id || r.id || 'Rule'}</span>
              <span className="text-muted-foreground">{r.result || r.status || r.action || ''}</span>
            </li>
          ))}
        </ul>
      </Section>
    </div>
  );
}