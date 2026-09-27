import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { X, Activity, RefreshCw, Loader2, CheckCircle, ShieldOff, ArrowUpRight } from 'lucide-react';
import { format } from 'date-fns';
import { cn } from '@/lib/utils';

const STATUS_STYLE = {
  APPROVED:      'bg-emerald-100 text-emerald-700 border-emerald-200',
  IN_REVIEW:     'bg-amber-100 text-amber-700 border-amber-200',
  AWAITING_USER: 'bg-amber-100 text-amber-700 border-amber-200',
  DECLINED:      'bg-red-100 text-red-700 border-red-200',
  PENDING:       'bg-slate-100 text-slate-600 border-slate-200',
};

export default function TransactionDetailPanel({ transaction, clientName, currentUser, onClose, onUpdated }) {
  const [refreshing, setRefreshing] = useState(false);
  const [notes, setNotes] = useState(transaction.review_notes || '');
  const [submitting, setSubmitting] = useState(false);
  const [action, setAction] = useState(null); // 'Approved' | 'Blocked' | 'Escalated'

  const isReviewable = ['IN_REVIEW', 'AWAITING_USER'].includes(transaction.status);
  const isDeclined = transaction.status === 'DECLINED';
  const alreadyReviewed = !!transaction.review_decision;

  async function refresh() {
    setRefreshing(true);
    try {
      await base44.functions.invoke('getDiditTransaction', { transaction_id: transaction.id });
      onUpdated();
    } finally {
      setRefreshing(false);
    }
  }

  async function submitReview(decision) {
    setSubmitting(true);
    await base44.entities.Transaction.update(transaction.id, {
      review_decision: decision,
      review_notes: notes,
      reviewed_by_user_id: currentUser.id,
      reviewed_at: new Date().toISOString(),
    });
    await base44.entities.AuditEvent.create({
      tenant_id: currentUser.tenant_id,
      case_id: transaction.case_id || null,
      client_id: transaction.client_id,
      actor_user_id: currentUser.id,
      actor_name: currentUser.full_name,
      actor_type: 'User',
      event_type: 'transaction_review_decision',
      notes: `Transaction ${transaction.id} reviewed: ${decision}. ${notes || ''}`.trim(),
    });
    setSubmitting(false);
    onUpdated();
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="flex-1 bg-black/30" onClick={onClose} />
      <div className="w-[520px] bg-card shadow-2xl flex flex-col h-full animate-slide-in-right border-l border-border">
        <div className="flex items-center justify-between px-5 py-4 border-b border-border flex-shrink-0">
          <div className="flex items-center gap-2">
            <Activity className="w-4 h-4 text-primary" />
            <span className="font-semibold text-sm">Transaction Detail</span>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X className="w-4 h-4" /></button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          <div className="flex items-center gap-2 flex-wrap">
            <span className={cn('text-xs font-medium px-2.5 py-1 rounded-full border', STATUS_STYLE[transaction.status])}>
              {transaction.status?.replace(/_/g, ' ')}
            </span>
            {transaction.risk_level && (
              <span className="text-xs font-medium px-2.5 py-1 rounded-full bg-muted text-muted-foreground border border-border">
                Risk: {transaction.risk_level}
              </span>
            )}
            {transaction.risk_score != null && (
              <span className="text-xs font-medium px-2.5 py-1 rounded-full bg-muted text-muted-foreground border border-border">
                Score: {transaction.risk_score}
              </span>
            )}
          </div>

          <div>
            <div className="text-base font-semibold text-foreground">{clientName}</div>
            <div className="text-xs text-muted-foreground mt-0.5">
              {transaction.direction} · {transaction.amount} {transaction.currency} ({transaction.currency_kind}) · Submitted {transaction.created_date ? format(new Date(transaction.created_date), 'd MMM yyyy HH:mm') : '—'}
            </div>
          </div>

          <div className="bg-muted/40 rounded-lg p-3 space-y-1">
            <div className="flex justify-between text-xs"><span className="text-muted-foreground">Category</span><span className="font-medium">{transaction.transaction_category?.replace(/_/g, ' ')}</span></div>
            <div className="flex justify-between text-xs"><span className="text-muted-foreground">Counterparty</span><span className="font-medium">{transaction.counterparty_name || '—'}</span></div>
            <div className="flex justify-between text-xs"><span className="text-muted-foreground">Method</span><span className="font-medium">{transaction.counterparty_method_type?.replace(/_/g, ' ')}</span></div>
            <div className="flex justify-between text-xs"><span className="text-muted-foreground">Account / Wallet</span><span className="font-medium max-w-[60%] truncate text-right">{transaction.counterparty_account_id}</span></div>
            <div className="flex justify-between text-xs"><span className="text-muted-foreground">Our Transaction ID</span><span className="font-medium max-w-[60%] truncate text-right">{transaction.our_transaction_id}</span></div>
            <div className="flex justify-between text-xs"><span className="text-muted-foreground">Didit Transaction ID</span><span className="font-medium max-w-[60%] truncate text-right">{transaction.didit_transaction_id || '—'}</span></div>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Didit Decision (Raw)</div>
              <Button size="sm" variant="ghost" className="h-6 text-xs gap-1" onClick={refresh} disabled={refreshing}>
                {refreshing ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />} Refresh
              </Button>
            </div>
            <pre className="bg-muted/30 rounded-lg p-3 text-[11px] leading-relaxed overflow-x-auto max-h-64 whitespace-pre-wrap break-all">
              {transaction.decision_raw ? JSON.stringify(transaction.decision_raw, null, 2) : 'No decision data yet.'}
            </pre>
          </div>

          {alreadyReviewed && (
            <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 text-xs text-slate-700 space-y-1">
              <div className="font-semibold">Review Decision: {transaction.review_decision}</div>
              {transaction.review_notes && <div>{transaction.review_notes}</div>}
              {transaction.reviewed_at && <div className="text-muted-foreground">{format(new Date(transaction.reviewed_at), 'd MMM yyyy HH:mm')}</div>}
            </div>
          )}

          {isDeclined && (
            <div className="flex items-center gap-2 bg-red-50 border border-red-200 rounded-lg p-3 text-xs text-red-700">
              <ShieldOff className="w-4 h-4 flex-shrink-0" /> This transaction was declined by Didit and is blocked. No further review action is available.
            </div>
          )}
        </div>

        {isReviewable && !alreadyReviewed && (
          <div className="border-t border-border p-5 space-y-3 flex-shrink-0">
            {!action ? (
              <div className="flex flex-col gap-2">
                <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">Analyst Decision</div>
                <Button size="sm" variant="outline" className="w-full gap-2 text-xs justify-start border-emerald-300 hover:bg-emerald-50 text-emerald-700" onClick={() => setAction('Approved')}>
                  <CheckCircle className="w-3.5 h-3.5" /> Approve
                </Button>
                <Button size="sm" variant="outline" className="w-full gap-2 text-xs justify-start border-red-300 hover:bg-red-50 text-red-700" onClick={() => setAction('Blocked')}>
                  <ShieldOff className="w-3.5 h-3.5" /> Block
                </Button>
                <Button size="sm" className="w-full gap-2 text-xs justify-start bg-amber-600 hover:bg-amber-700 text-white" onClick={() => setAction('Escalated')}>
                  <ArrowUpRight className="w-3.5 h-3.5" /> Escalate for Compliance Review
                </Button>
              </div>
            ) : (
              <div className="space-y-3">
                <div className="text-xs font-semibold">Notes {action === 'Blocked' ? '(required)' : '(optional)'}</div>
                <Textarea value={notes} onChange={e => setNotes(e.target.value)} placeholder="Document your decision…" className="text-xs min-h-16 resize-none" />
                <div className="flex gap-2">
                  <Button size="sm" variant="ghost" className="text-xs" onClick={() => setAction(null)}>Back</Button>
                  <Button size="sm" className="flex-1 text-xs gap-1" onClick={() => submitReview(action)}
                    disabled={submitting || (action === 'Blocked' && !notes.trim())}>
                    {submitting ? <Loader2 className="w-3 h-3 animate-spin" /> : <CheckCircle className="w-3 h-3" />}
                    Confirm {action}
                  </Button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}