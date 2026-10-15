import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';

/** Latest transactions of a counterparty (one page of 10). */
export default function CounterpartyTransactions({ tenantId, counterpartyId }) {
  const { data, isLoading } = useQuery({
    queryKey: ['counterparty-txns', tenantId, counterpartyId],
    queryFn: async () => (await base44.entities.Transaction.filter({ tenant_id: tenantId, counterparty_id: counterpartyId }, { sort: '-executed_at', limit: 10 })).items,
  });
  if (isLoading) return <p className="text-xs text-muted-foreground">Loading…</p>;
  if (!data?.length) return <p className="text-xs text-muted-foreground">No transactions.</p>;
  return (
    <ul className="divide-y divide-border rounded-lg border border-border">
      {data.map((t) => (
        <li key={t.id} className="flex justify-between gap-3 px-3 py-2 text-xs">
          <span className="truncate">{String(t.executed_at || t.created_date || '').slice(0, 10)} · {t.direction} · {t.counterparty_name || '—'}</span>
          <span className="font-medium tabular-nums">{t.amount} {t.currency}</span>
        </li>
      ))}
    </ul>
  );
}