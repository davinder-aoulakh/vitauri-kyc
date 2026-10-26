import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router-dom';
import { toAlert } from '@/lib/routes';
import { format } from 'date-fns';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import EmptyState from '@/components/shared/EmptyState';
import InlineError from '@/components/shared/InlineError';
import { Activity, Loader2 } from 'lucide-react';

const SOURCES = ['manual', 'api', 'psd2', 'upload_csv', 'upload_xlsx', 'upload_mt940', 'upload_camt', 'upload_pdf'];
const LIFECYCLES = ['intended', 'declined', 'booked', 'reversed', 'corrected'];
const PAGE = 100;
// Didit's per-transaction risk level as stored from the webhook (case differs between payload versions).
const DIDIT_HIGH = ['HIGH', 'High', 'high', 'CRITICAL', 'Critical', 'critical'];
const RISK_TONE = {
  CRITICAL: 'bg-red-50 text-red-700 border-red-200 dark:bg-red-500/15 dark:text-red-200 dark:border-red-500/30',
  HIGH: 'bg-red-50 text-red-700 border-red-200 dark:bg-red-500/15 dark:text-red-200 dark:border-red-500/30',
  MEDIUM: 'bg-amber-50 text-amber-800 border-amber-200 dark:bg-amber-500/15 dark:text-amber-200 dark:border-amber-500/30',
  LOW: 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-500/15 dark:text-emerald-200 dark:border-emerald-500/30',
};
function DiditRisk({ tx }) {
  const level = String(tx.risk_level || '').toUpperCase();
  const hasScore = tx.risk_score != null && tx.risk_score !== '';
  if (!level && !hasScore) return <span className="text-muted-foreground">—</span>;
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium whitespace-nowrap ${RISK_TONE[level] || 'bg-secondary text-muted-foreground border-border'}`}>
      {level ? level.charAt(0) + level.slice(1).toLowerCase() : 'Score'}{hasScore && <span className="tabular-nums opacity-80">{Math.round(Number(tx.risk_score))}</span>}
    </span>
  );
}
const label = (v) => String(v || '').replace(/_/g, ' ');
const flag = (cc) => (/^[A-Za-z]{2}$/.test(cc || '') ? String.fromCodePoint(...[...cc.toUpperCase()].map((c) => 127397 + c.charCodeAt(0))) : '');

function Filter({ value, onChange, all, items, render = label, width = 'w-40' }) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className={`h-8 text-xs ${width}`}><SelectValue /></SelectTrigger>
      <SelectContent>
        <SelectItem value="all">{all}</SelectItem>
        {items.map((i) => <SelectItem key={i.id ?? i} value={i.id ?? i}>{i.id ? i.name : render(i)}</SelectItem>)}
      </SelectContent>
    </Select>
  );
}

/** TM version of the transaction table: canonical columns and server-side filters. Used only when tm_core is on.
 *  fixedClientId: show one customer's transactions only (customer file); the client filter and column are hidden. */
export default function TmTransactionList({ tenantId, clients, version, onSelect, fixedClientId }) {
  const [status, setStatus] = useState('all');
  const [source, setSource] = useState('all');
  const [lifecycle, setLifecycle] = useState('all');
  const [client, setClient] = useState(fixedClientId || 'all');
  const [searchParams] = useSearchParams();
  const [risk, setRisk] = useState(searchParams.get('risk') === 'didit_high' ? 'didit_high' : 'all');
  const [limit, setLimit] = useState(PAGE);
  const query = { tenant_id: tenantId };
  if (status !== 'all') query.status = status;
  if (source !== 'all') query.source_type = source;
  if (lifecycle !== 'all') query.lifecycle = lifecycle;
  if (client !== 'all') query.client_id = client;
  if (risk === 'didit_high') query.risk_level = { $in: DIDIT_HIGH };

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['tmTxList', tenantId, status, source, lifecycle, client, risk, limit, version],
    enabled: !!tenantId,
    queryFn: async () => {
      const page = await base44.entities.Transaction.filter(query, { sort: '-created_date', limit });
      const rows = page.items || [];
      const alerts = rows.length
        ? (await base44.entities.TmAlert.filter({ tenant_id: tenantId, transaction_ids: { $in: rows.map((r) => r.id) } }, { limit: 500 })).items || []
        : [];
      const byTxn = {};
      alerts.forEach((a) => (a.transaction_ids || []).forEach((id) => { byTxn[id] ||= a; }));
      return { rows, byTxn, more: page.has_more };
    },
  });
  const rows = data?.rows || [];
  const reset = (set) => (v) => { set(v); setLimit(PAGE); };
  const clientName = (id) => clients.find((c) => c.id === id)?.full_name || '—';
  const date = (iso) => (iso ? format(new Date(iso), 'd MMM yyyy HH:mm') : '—');

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap justify-end gap-2">
        {!fixedClientId && <Filter value={client} onChange={reset(setClient)} all="All clients" items={clients.map((c) => ({ id: c.id, name: c.full_name }))} width="w-48" />}
        <Filter value={source} onChange={reset(setSource)} all="All sources" items={SOURCES} />
        <Filter value={lifecycle} onChange={reset(setLifecycle)} all="All lifecycles" items={LIFECYCLES} />
        <Filter value={status} onChange={reset(setStatus)} all="All statuses" items={['PENDING', 'APPROVED', 'IN_REVIEW', 'AWAITING_USER', 'DECLINED']} />
        <Filter value={risk} onChange={reset(setRisk)} all="Any Didit risk" items={[{ id: 'didit_high', name: 'Didit High or Critical' }]} width="w-44" />
      </div>
      {error && <InlineError message="Couldn't load transactions." onRetry={() => refetch()} />}
      <div className="bg-card border border-border rounded-xl overflow-x-auto">
        {isLoading ? (
          <div className="flex items-center justify-center py-12"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>
        ) : rows.length === 0 ? (
          <EmptyState icon={Activity} title="No transactions" description="Transactions matching these filters will appear here." />
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-muted/40 border-b border-border text-xs text-muted-foreground uppercase tracking-wide">
                {[...(fixedClientId ? [] : ['Client']), 'Executed', 'Amount', 'Lifecycle', 'Source', 'Category', 'Counterparty', 'Didit risk', 'Alert'].map((h) => <th key={h} className="text-left px-4 py-3 whitespace-nowrap">{h}</th>)}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.map((tx) => {
                const alert = data.byTxn[tx.id];
                return (
                  <tr key={tx.id} className="hover:bg-muted/20 transition-colors cursor-pointer" onClick={() => onSelect(tx)}>
                    {!fixedClientId && <td className="px-4 py-3 font-medium text-xs">{clientName(tx.client_id)}</td>}
                    <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">{date(tx.executed_at)}</td>
                    <td className="px-4 py-3 text-xs whitespace-nowrap">{tx.direction === 'outbound' ? '−' : '+'}{tx.amount} {tx.currency}</td>
                    <td className="px-4 py-3 text-xs capitalize">{tx.lifecycle || '—'}</td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">{label(tx.source_type) || '—'}</td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">{label(tx.category) || '—'}</td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">{tx.counterparty_name || '—'}{tx.counterparty_country && <span className="ml-1.5">{flag(tx.counterparty_country)} {tx.counterparty_country}</span>}</td>
                    <td className="px-4 py-3 text-xs"><DiditRisk tx={tx} /></td>
                    <td className="px-4 py-3 text-xs" onClick={(e) => e.stopPropagation()}>
                      {alert ? <Link className="text-primary hover:underline" to={toAlert(alert.id)} title={alert.title}>{label(alert.status)}</Link> : '—'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
      {data?.more && <div className="flex justify-center"><Button size="sm" variant="outline" onClick={() => setLimit(limit + PAGE)}>Load more</Button></div>}
    </div>
  );
}