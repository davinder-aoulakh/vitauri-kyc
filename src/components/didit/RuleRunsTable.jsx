import React, { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { cn } from '@/lib/utils';
import { ruleRuns } from '@/lib/diditReadable';
import { toRule } from '@/lib/routes';
import { ChevronDown, ChevronUp } from 'lucide-react';

const asList = (r) => (Array.isArray(r) ? r : r?.items || []);

/** Vitauri rules and scenarios of the tenant, keyed for rule-run lookup (cached). */
export function useRuleLookup(tenantId, enabled = true) {
  return useQuery({
    queryKey: ['rule-lookup', tenantId], enabled: enabled && !!tenantId, staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const [rules, scenarios] = await Promise.all([
        base44.entities.TmRule.filter({ tenant_id: tenantId, didit_rule_id: { $exists: true } }, '-created_date', 1000).then(asList).catch(() => []),
        base44.entities.TmScenario.filter({ tenant_id: tenantId }, 'code', 1000).then(asList).catch(() => []),
      ]);
      return { rulesByDiditId: new Map(rules.filter((r) => r.didit_rule_id).map((r) => [r.didit_rule_id, r])), scenariosById: new Map(scenarios.map((s) => [s.id, s])) };
    },
  });
}

/** Didit rule runs as a readable table: which rule ran, the Vitauri rule/scenario behind it, outcome and score. */
export default function RuleRunsTable({ runs, tenantId, showTxn = false }) {
  const { data } = useRuleLookup(tenantId, (runs || []).length > 0);
  const rows = useMemo(() => ruleRuns(runs, data?.rulesByDiditId, data?.scenariosById), [runs, data]);
  const [open, setOpen] = useState(null);
  if (!rows.length) return <p className="text-xs text-muted-foreground">No Didit rules ran on this transaction.</p>;
  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <table className="w-full text-xs">
        <thead className="bg-muted/40 text-left text-muted-foreground">
          <tr>
            <th className="px-2 py-1.5 font-medium">Rule</th>
            <th className="px-2 py-1.5 font-medium">Outcome</th>
            <th className="px-2 py-1.5 font-medium text-right">Score</th>
            {showTxn && <th className="px-2 py-1.5 font-medium">Transaction</th>}
            <th className="w-6" />
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {rows.map((r) => (
            <React.Fragment key={r.key}>
              <tr className="align-top">
                <td className="px-2 py-1.5">
                  {r.rule ? (
                    <Link to={toRule(r.rule.id)} className="font-medium text-primary hover:underline">{r.rule.name}{r.rule.version ? ` v${r.rule.version}` : ''}</Link>
                  ) : <span className="font-medium">{r.diditName}</span>}
                  <div className="text-[11px] text-muted-foreground">
                    {r.scenario ? `${r.scenario.code} · ${r.scenario.name}` : r.rule ? '' : 'Rule not managed in Vitauri'}
                    {r.rule && r.rule.mode === 'unmanaged' && <span className="ml-1 rounded-full bg-amber-100 px-1.5 text-amber-800">Unmanaged</span>}
                  </div>
                  {r.message && <div className="mt-0.5 text-[11px]">{r.message}</div>}
                </td>
                <td className="px-2 py-1.5">
                  <span className={cn('rounded-full border px-1.5 py-0.5 text-[11px]', r.triggered ? 'border-amber-200 bg-amber-50 text-amber-800' : 'border-border bg-muted text-muted-foreground')}>{r.outcome}</span>
                </td>
                <td className="px-2 py-1.5 text-right tabular-nums">{r.score ?? '—'}</td>
                {showTxn && <td className="px-2 py-1.5 text-muted-foreground">{r.txn ? `…${String(r.txn).slice(-6)}` : '—'}</td>}
                <td className="px-1 py-1.5">
                  {r.details.length > 0 && (
                    <button type="button" onClick={() => setOpen(open === r.key ? null : r.key)} aria-label="More details" className="text-muted-foreground hover:text-foreground">
                      {open === r.key ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                    </button>
                  )}
                </td>
              </tr>
              {open === r.key && (
                <tr><td colSpan={showTxn ? 5 : 4} className="bg-muted/20 px-3 py-1.5">
                  {r.details.map((d) => <div key={d.label} className="flex justify-between gap-3 py-0.5"><span className="text-muted-foreground">{d.label}</span><span>{d.value}</span></div>)}
                </td></tr>
              )}
            </React.Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
}
