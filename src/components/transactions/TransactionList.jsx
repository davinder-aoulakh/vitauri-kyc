import React from 'react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import EmptyState from '@/components/shared/EmptyState';
import { Activity, Loader2, ChevronRight } from 'lucide-react';
import { format } from 'date-fns';
import { cn } from '@/lib/utils';

const STATUS_STYLE = {
  APPROVED:      'bg-emerald-100 text-emerald-700 border-emerald-200',
  IN_REVIEW:     'bg-amber-100 text-amber-700 border-amber-200',
  AWAITING_USER: 'bg-amber-100 text-amber-700 border-amber-200',
  DECLINED:      'bg-red-100 text-red-700 border-red-200',
  PENDING:       'bg-slate-100 text-slate-600 border-slate-200',
};

export default function TransactionList({ transactions, clients, loading, filterStatus, setFilterStatus, onSelect }) {
  const clientName = (id) => clients.find(c => c.id === id)?.full_name || '—';
  const filtered = filterStatus === 'all' ? transactions : transactions.filter(t => t.status === filterStatus);

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <Select value={filterStatus} onValueChange={setFilterStatus}>
          <SelectTrigger className="h-8 text-xs w-48"><SelectValue placeholder="Status" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Statuses</SelectItem>
            <SelectItem value="PENDING">Pending</SelectItem>
            <SelectItem value="APPROVED">Approved</SelectItem>
            <SelectItem value="IN_REVIEW">In Review</SelectItem>
            <SelectItem value="AWAITING_USER">Awaiting User</SelectItem>
            <SelectItem value="DECLINED">Declined</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="bg-card border border-border rounded-xl overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
          </div>
        ) : filtered.length === 0 ? (
          <EmptyState icon={Activity} title="No transactions" description="Screened transactions will appear here." />
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-muted/40 border-b border-border text-xs text-muted-foreground uppercase tracking-wide">
                <th className="text-left px-4 py-3">Client</th>
                <th className="text-left px-4 py-3">Direction</th>
                <th className="text-left px-4 py-3">Amount</th>
                <th className="text-left px-4 py-3">Counterparty</th>
                <th className="text-left px-4 py-3">Submitted</th>
                <th className="text-left px-4 py-3">Status</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {filtered.map(tx => (
                <tr key={tx.id} className="hover:bg-muted/20 transition-colors cursor-pointer" onClick={() => onSelect(tx)}>
                  <td className="px-4 py-3 font-medium text-xs">{clientName(tx.client_id)}</td>
                  <td className="px-4 py-3 text-xs text-muted-foreground capitalize">{tx.direction}</td>
                  <td className="px-4 py-3 text-xs">{tx.amount} {tx.currency}</td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">{tx.counterparty_name || '—'}</td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">
                    {tx.created_date ? format(new Date(tx.created_date), 'd MMM yyyy HH:mm') : '—'}
                  </td>
                  <td className="px-4 py-3">
                    <span className={cn('text-xs px-2 py-0.5 rounded-full font-medium border', STATUS_STYLE[tx.status])}>
                      {tx.status?.replace(/_/g, ' ')}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right"><ChevronRight className="w-4 h-4 text-muted-foreground inline" /></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}