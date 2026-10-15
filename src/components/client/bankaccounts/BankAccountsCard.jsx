import React, { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { useTenant } from '@/lib/tenantContext';
import { isFeatureEnabled } from '@/lib/featureFlags';
import { hasPermission } from '@/lib/permissions';
import { addDays, fetchAll, stripCells, toIso, STRIP_DAYS } from '@/lib/tmCoverage';
import { Button } from '@/components/ui/button';
import InlineError from '@/components/shared/InlineError';
import CoverageStrip from '@/components/tm/coverage/CoverageStrip';
import StatementUploadDrawer from '@/components/tm/StatementUploadDrawer';
import AccountFormDialog from '@/components/client/bankaccounts/AccountFormDialog';
import CloseAccountDialog from '@/components/client/bankaccounts/CloseAccountDialog';
import { Loader2, Plus } from 'lucide-react';

/** "Bank accounts" card on the client Monitoring tab. Needs tm_core + tmWorkCase. */
export default function BankAccountsCard({ client }) {
  const { currentUser, tenant } = useTenant();
  const qc = useQueryClient();
  const tenantId = currentUser?.tenant_id;
  const enabled = isFeatureEnabled(tenant, 'tm_core') && hasPermission(currentUser?.app_role, 'tmWorkCase');
  const key = ['client-bank-accounts', tenantId, client.id];
  const [form, setForm] = useState(null); // { account | null }
  const [closing, setClosing] = useState(null);
  const [upload, setUpload] = useState(null); // account id

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: key,
    enabled: enabled && !!tenantId,
    queryFn: async () => {
      const end = addDays(toIso(new Date()), -1);
      const start = addDays(end, -(STRIP_DAYS - 1));
      const [accounts, rows] = await Promise.all([
        fetchAll((cursor) => base44.entities.BankAccount.filter({ tenant_id: tenantId, client_id: client.id }, { limit: 200, cursor })),
        fetchAll((cursor) => base44.entities.CoverageDay.filter({ tenant_id: tenantId, client_id: client.id, date: { $gte: start, $lte: end } }, { sort: 'date', limit: 1000, cursor }), 5),
      ]);
      return { accounts, rows, start, end };
    },
  });

  if (!enabled) return null;
  const refresh = () => qc.invalidateQueries({ queryKey: key });
  const reopen = async (a) => {
    await base44.functions.invoke('manageBankAccount', { action: 'reopen', id: a.id });
    refresh();
  };

  return (
    <section className="rounded-xl border border-border bg-card">
      <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
        <h3 className="text-sm font-semibold">Bank accounts</h3>
        <Button size="sm" className="gap-1.5" onClick={() => setForm({ account: null })}><Plus className="h-3.5 w-3.5" /> Add account</Button>
      </div>
      {isLoading && <div className="flex justify-center py-8"><Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /></div>}
      {error && <div className="p-4"><InlineError message="Could not load bank accounts." onRetry={refetch} /></div>}
      {data && data.accounts.length === 0 && <p className="px-4 py-6 text-sm text-muted-foreground">No bank accounts yet.</p>}
      {data && data.accounts.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-xs text-muted-foreground">
              <tr className="border-b border-border">
                {['Account', 'Institution', 'Currency', 'Source', 'Frequency', 'Owned', 'Status', 'Last 30 days', ''].map((h) => <th key={h} className="px-3 py-2 text-left font-medium">{h}</th>)}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {data.accounts.map((a) => (
                <tr key={a.id}>
                  <td className="px-3 py-2 font-mono text-xs whitespace-nowrap">{a.iban_or_number}</td>
                  <td className="px-3 py-2">{a.institution || '—'}</td>
                  <td className="px-3 py-2">{a.currency || '—'}</td>
                  <td className="px-3 py-2">{a.source_type || '—'}</td>
                  <td className="px-3 py-2">{a.expected_frequency || 'daily'}</td>
                  <td className="px-3 py-2">{a.is_customer_owned === false ? 'No' : 'Yes'}</td>
                  <td className="px-3 py-2 capitalize">{a.status || 'active'}{a.status === 'closed' && a.closed_at ? ` · ${a.closed_at}` : ''}</td>
                  <td className="px-3 py-2"><CoverageStrip cells={stripCells(data.rows.filter((r) => r.bank_account_id === a.id), data.start, data.end)} /></td>
                  <td className="px-3 py-2 whitespace-nowrap text-right">
                    <Button variant="ghost" size="sm" onClick={() => setForm({ account: a })}>Edit</Button>
                    {a.status === 'closed'
                      ? <Button variant="ghost" size="sm" onClick={() => reopen(a)}>Reopen</Button>
                      : <Button variant="ghost" size="sm" onClick={() => setClosing(a)}>Close</Button>}
                    <Button variant="ghost" size="sm" onClick={() => setUpload(a.id)}>Upload statement</Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {form && (
        <AccountFormDialog key={form.account?.id || 'new'} open onOpenChange={(o) => !o && setForm(null)} clientId={client.id} account={form.account} onSaved={refresh} />
      )}
      {closing && <CloseAccountDialog key={closing.id} account={closing} onOpenChange={(o) => !o && setClosing(null)} onDone={refresh} />}
      <StatementUploadDrawer
        key={upload || 'none'} open={!!upload} onOpenChange={(o) => !o && setUpload(null)}
        clientId={client.id} bankAccountId={upload || undefined} onCommitted={refresh}
      />
    </section>
  );
}