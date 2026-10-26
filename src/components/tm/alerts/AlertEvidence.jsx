import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { PROPOSAL_LABEL } from '@/lib/tmAlerts';
import CounterpartyLink from '@/components/tm/counterparty/CounterpartyLink';
import SourceChips from '@/components/tm/kit/SourceChips';
import RuleRunsTable from '@/components/didit/RuleRunsTable';

const Section = ({ title, children }) => (
  <section className="space-y-2">
    <h3 className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">{title}</h3>
    {children}
  </section>
);

const list = (r) => (Array.isArray(r) ? r : r?.items || []);

/** counterpartyId -> { text, linked } for counterparties that are (or look like) the alert client's own related parties. */
function useRelatedPartyChips(alert, txns) {
  const cpIds = [...new Set(txns.map((t) => t.counterparty_id).filter(Boolean))].slice(0, 50);
  return useQuery({
    queryKey: ['alert-rp-chips', alert.tenant_id, alert.client_id, cpIds.join(',')],
    enabled: !!alert.tenant_id && !!alert.client_id && cpIds.length > 0,
    staleTime: 60000,
    queryFn: async () => {
      const cps = list(await base44.entities.Counterparty.filter({ tenant_id: alert.tenant_id, id: { $in: cpIds } }, undefined, 50))
        .filter((c) => c.related_party_id || c.suggested_related_party_id);
      if (!cps.length) return {};
      const links = list(await base44.entities.ClientRelatedPartyLink.filter({ tenant_id: alert.tenant_id, client_id: alert.client_id }, undefined, 200));
      const ids = [...new Set(links.map((l) => l.related_party_id).filter(Boolean))];
      const parties = ids.length ? list(await base44.entities.RelatedParty.filter({ tenant_id: alert.tenant_id, id: { $in: ids } }, undefined, 200)) : [];
      const out = {};
      for (const c of cps) {
        const pid = c.related_party_id || c.suggested_related_party_id;
        const p = parties.find((x) => x.id === pid);
        if (!p) continue;
        const l = links.find((x) => x.related_party_id === pid) || {};
        const role = l.role || p.role_in_relationship || 'related party';
        const pct = l.ownership_percentage ?? p.ownership_percentage;
        out[c.id] = { linked: !!c.related_party_id, text: `${c.related_party_id ? '' : 'Possibly '}client's ${role}${pct ? ` (${pct}%)` : ''}`, title: p.full_name };
      }
      return out;
    },
  });
}

const fmtAmount = (t) => `${t.direction === 'outbound' ? '−' : '+'}${Number(t.amount || 0).toLocaleString('en-US')} ${t.currency || ''}`;

export default function AlertEvidence({ alert, txns }) {
  const ruleRuns = txns.flatMap((t) => (t.didit_rule_runs || []).map((r) => ({ ...r, txn: t.id })));
  const { data: rpChips = {} } = useRelatedPartyChips(alert, txns);
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
                  {r.source_refs?.length > 0 && <SourceChips refs={r.source_refs} className="mt-1 flex" />}
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
              <span className="truncate"><CounterpartyLink id={t.counterparty_id}>{t.counterparty_name || 'Unknown counterparty'}</CounterpartyLink> · {String(t.executed_at || '').slice(0, 10)}
                {rpChips[t.counterparty_id] && (
                  <span title={rpChips[t.counterparty_id].title}
                    className={`ml-1.5 inline-block rounded-full border px-1.5 py-px text-[10px] font-medium ${rpChips[t.counterparty_id].linked ? 'border-sky-200 bg-sky-50 text-sky-800 dark:border-sky-500/30 dark:bg-sky-500/15 dark:text-sky-200' : 'border-dashed border-sky-300 text-sky-700 dark:text-sky-300'}`}>
                    {rpChips[t.counterparty_id].text}
                  </span>
                )}
              </span>
              <span className="font-medium tabular-nums">{fmtAmount(t)}</span>
            </li>
          ))}
        </ul>
      </Section>
      <Section title="Rule runs">
        <RuleRunsTable runs={ruleRuns} tenantId={alert.tenant_id} showTxn={txns.length > 1} />
      </Section>
    </div>
  );
}