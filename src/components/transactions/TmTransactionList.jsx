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
import { Activity, Loader2, RotateCcw, Ban } from 'lucide-react';
import Flag from '@/components/shared/Flag';
import { toast } from '@/components/ui/use-toast';

// Didit's decision on the transaction (status) and whether Vitauri could send it (submission)
const STATUS_TONE = {
  APPROVED: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  IN_REVIEW: 'bg-amber-50 text-amber-800 border-amber-200',
  AWAITING_USER: 'bg-sky-50 text-sky-700 border-sky-200',
  DECLINED: 'bg-red-50 text-red-700 border-red-200',
  PENDING: 'bg-secondary text-muted-foreground border-border',
};
function DiditStatus({ tx }) {
  if (tx.blocked) return <span className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium bg-red-600 text-white border-red-600" title={tx.blocked_reason || 'Declined by Didit'}><Ban className="w-3 h-3" /> Blocked</span>;
  const s = tx.status || 'PENDING';
  return <span className={`inline-flex rounded-full border px-2 py-0.5 text-[11px] font-medium whitespace-nowrap ${STATUS_TONE[s] || STATUS_TONE.PENDING}`}>{s === 'PENDING' ? 'Pending' : label(s).toLowerCase().replace(/^./, (c) => c.toUpperCase())}</span>;
}

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
  const [submission, setSubmission] = useState('all');
  const [retrying, setRetrying] = useState(null);
  const [limit, setLimit] = useState(PAGE);
  const query = { tenant_id: tenantId };
  if (status !== 'all') query.status = status;
  if (source !== 'all') query.source_type = source;
  if (lifecycle !== 'all') query.lifecycle = lifecycle;
  if (client !== 'all') query.client_id = client;
  if (risk === 'didit_high') query.risk_level = { $in: DIDIT_HIGH };
  if (submission === 'blocked') query.blocked = true;
  else if (submission !== 'all') query.didit_submission_status = submission;

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['tmTxList', tenantId, status, source, lifecycle, client, risk, submission, limit, version],
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

  // Send one transaction (again) to Didit: failed or not yet submitted
  async function resend(tx) {
    setRetrying(tx.id);
    try {
      const res = await base44.functions.invoke('submitToDidit', { tenant_id: tenantId, transaction_ids: [tx.id] });
      const d = res?.data || {};
      if (d.error) throw new Error(d.error);
      toast({ title: d.skipped ? `Not sent: ${String(d.reason || '').replace(/_/g, ' ')}` : d.submitted ? 'Sent to Didit' : 'Didit did not accept it — see the transaction' });
      refetch();
    } catch (e) {
      toast({ variant: 'destructive', title: 'Could not send to Didit', description: e?.response?.data?.error || e?.message });
    } finally {
      setRetrying(null);
    }
  }
  const Submission = ({ tx }) => {
    const s = tx.didit_submission_status || 'not_submitted';
    if (s === 'submitted') return <span className="text-emerald-700">Sent</span>;
    if (s === 'skipped') return <span className="text-muted-foreground" title={tx.didit_submission_note}>Not sent</span>;
    return (
      <span className="inline-flex items-center gap-1.5">
        <span className={s === 'failed' ? 'text-red-700' : 'text-muted-foreground'} title={tx.didit_submission_error || tx.didit_submission_note}>{s === 'failed' ? 'Failed' : 'Not sent'}</span>
        <button type="button" className="text-primary hover:underline inline-flex items-center gap-0.5" disabled={retrying === tx.id}
          onClick={(e) => { e.stopPropagation(); resend(tx); }}>
          {retrying === tx.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <RotateCcw className="w-3 h-3" />} {s === 'failed' ? 'Retry' : 'Send'}
        </button>
      </span>
    );
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap justify-end gap-2">
        {!fixedClientId && <Filter value={client} onChange={reset(setClient)} all="All clients" items={clients.map((c) => ({ id: c.id, name: c.full_name }))} width="w-48" />}
        <Filter value={source} onChange={reset(setSource)} all="All sources" items={SOURCES} />
        <Filter value={lifecycle} onChange={reset(setLifecycle)} all="All lifecycles" items={LIFECYCLES} />
        <Filter value={status} onChange={reset(setStatus)} all="All statuses" items={['PENDING', 'APPROVED', 'IN_REVIEW', 'AWAITING_USER', 'DECLINED']} />
        <Filter value={risk} onChange={reset(setRisk)} all="Any Didit risk" items={[{ id: 'didit_high', name: 'Didit High or Critical' }]} width="w-44" />
        <Filter value={submission} onChange={reset(setSubmission)} all="Any submission" items={[{ id: 'blocked', name: 'Blocked (declined)' }, { id: 'failed', name: 'Submission failed' }, { id: 'not_submitted', name: 'Not sent yet' }, { id: 'skipped', name: 'Not sent (skipped)' }, { id: 'submitted', name: 'Sent to Didit' }]} width="w-44" />
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
                {[...(fixedClientId ? [] : ['Client']), 'Executed', 'Amount', 'Lifecycle', 'Source', 'Category', 'Counterparty', 'Didit status', 'Didit risk', 'Submission', 'Alert'].map((h) => <th key={h} className="text-left px-4 py-3 whitespace-nowrap">{h}</th>)}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.map((tx) => {
                const alert = data.byTxn[tx.id];
                return (
                  <tr key={tx.id} className="hover:bg-muted/20 transition-colors cursor-pointer" onClick={() => onSelect(tx)}>
                    {!fixedClientId && <td className="px-4 py-3 font-medium text-xs">{clientName(tx.client_id)}</td>}
                    <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">{date(tx.executed_at)}</td>
                    <td className="px-4 py-3 text-xs whitespace-nowrap">{tx.direction === 'outbound' ? '−' : '+'}{tx.amount} {tx.currency}{tx.currency_kind === 'crypto' && <span className="ml-1.5 rounded border border-violet-200 bg-violet-50 px-1 text-[10px] text-violet-700" title={tx.counterparty_method_type === 'unhosted_wallet' ? 'Self-custody wallet' : 'Crypto wallet'}>crypto</span>}</td>
                    <td className="px-4 py-3 text-xs capitalize">{tx.lifecycle || '—'}</td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">{label(tx.source_type) || '—'}</td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">{label(tx.category) || '—'}</td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">{tx.counterparty_name || '—'}{tx.counterparty_country && <span className="ml-1.5 inline-flex items-center gap-1"><Flag iso2={tx.counterparty_country} className="w-4 h-3" /> {tx.counterparty_country}</span>}</td>
                    <td className="px-4 py-3 text-xs"><DiditStatus tx={tx} /></td>
                    <td className="px-4 py-3 text-xs"><DiditRisk tx={tx} /></td>
                    <td className="px-4 py-3 text-xs whitespace-nowrap"><Submission tx={tx} /></td>
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