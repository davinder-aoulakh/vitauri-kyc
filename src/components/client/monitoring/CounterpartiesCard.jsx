import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTenant } from '@/lib/tenantContext';
import { hasPermission } from '@/lib/permissions';
import { Button } from '@/components/ui/button';
import InlineError from '@/components/shared/InlineError';
import CounterpartyLink from '@/components/tm/counterparty/CounterpartyLink';
import { fetchCounterparties, isLowConfidence } from '@/lib/tmCounterparty';
import { Loader2 } from 'lucide-react';

/** "Counterparties" card on the Monitoring tab: top 10 by amount, View all expands to 100. Parent checks tm_core. */
export default function CounterpartiesCard({ client }) {
  const { currentUser, tenant } = useTenant();
  const tenantId = currentUser?.tenant_id;
  const [all, setAll] = useState(false);
  const allowed = hasPermission(currentUser?.app_role, 'tmViewAlerts');
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['client-counterparties', tenantId, client.id, all],
    enabled: allowed && !!tenantId,
    queryFn: () => fetchCounterparties({ client_id: client.id, limit: all ? 100 : 10 }),
  });
  if (!allowed) return null;
  const rows = data?.counterparties || [];

  return (
    <section className="rounded-xl border border-border bg-card">
      <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
        <h3 className="text-sm font-semibold">Counterparties</h3>
        <Button size="sm" variant="ghost" onClick={() => setAll((v) => !v)}>{all ? 'Show top 10' : 'View all'}</Button>
      </div>
      {isLoading && <div className="flex justify-center py-8"><Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /></div>}
      {error && <div className="p-4"><InlineError message="Could not load counterparties." onRetry={refetch} /></div>}
      {data && rows.length === 0 && <p className="px-4 py-6 text-sm text-muted-foreground">No counterparties yet.</p>}
      {rows.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-xs text-muted-foreground">
              <tr className="border-b border-border">{['Counterparty', 'Country', 'Transactions', `Total (${tenant?.tm_reporting_currency || ''})`, 'Last seen'].map((h) => <th key={h} className="px-3 py-2 text-left font-medium">{h}</th>)}</tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.map((c) => (
                <tr key={c.id}>
                  <td className="px-3 py-2">
                    <CounterpartyLink id={c.id}>{c.display_name}</CounterpartyLink>
                    {isLowConfidence(c.lowest_confidence) && <span className="ml-2 rounded-full border border-amber-200 bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-800">Low confidence</span>}
                  </td>
                  <td className="px-3 py-2">{c.country || '—'}</td>
                  <td className="px-3 py-2 tabular-nums">{c.transaction_count}</td>
                  <td className="px-3 py-2 tabular-nums">{c.total_amount.toLocaleString()}</td>
                  <td className="px-3 py-2">{c.last_seen ? c.last_seen.slice(0, 10) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}