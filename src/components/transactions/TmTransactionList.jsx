import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
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
  const [limit, setLimit] = useState(PAGE);
  const query = { tenant_id: tenantId };
  if (status !== 'all') query.status = status;
  if (source !== 'all') query.source_type = source;
  if (lifecycle !== 'all') query.lifecycle = lifecycle;
  if (client !== 'all') query.client_id = client;

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['tmTxList', tenantId, status, source, lifecycle, client, limit, version],
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
                {[...(fixedClientId ? [] : ['Client']), 'Executed', 'Amount', 'Lifecycle', 'Source', 'Category', 'Counterparty', 'Alert'].map((h) => <th key={h} className="text-left px-4 py-3 whitespace-nowrap">{h}</th>)}
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