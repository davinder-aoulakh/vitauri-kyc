import React from 'react';
import { Link } from 'react-router-dom';
import { useTenant } from '@/lib/tenantContext';
import { isFeatureEnabled } from '@/lib/featureFlags';
import { hasPermission } from '@/lib/permissions';
import EmptyState from '@/components/shared/EmptyState';
import CoverageStrip, { CoverageLegend } from '@/components/tm/coverage/CoverageStrip';
import { Landmark } from 'lucide-react';

export default function AccountsCoverageTable({ rows, start, end }) {
  const { currentUser, tenant } = useTenant();
  const canManage = isFeatureEnabled(tenant, 'tm_core') && hasPermission(currentUser?.app_role, 'tmWorkCase') && hasPermission(currentUser?.app_role, 'createRunCase');
  return (
    <section className="bg-card border border-border rounded-lg">
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 border-b border-border">
        <div>
          <h2 className="text-sm font-semibold">Coverage per account</h2>
          <p className="text-xs text-muted-foreground">Daily coverage: {start} → {end}</p>
        </div>
        <CoverageLegend />
      </div>
      {rows.length === 0 ? (
        <EmptyState icon={Landmark} title="No active bank accounts" description="Accounts appear here once transactions are ingested or a statement is uploaded." />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-xs text-muted-foreground">
              <tr className="border-b border-border">
                <th className="text-left font-medium px-4 py-2">Customer</th>
                <th className="text-left font-medium px-4 py-2">Account</th>
                <th className="text-left font-medium px-4 py-2">Coverage</th>
                <th className="text-right font-medium px-4 py-2">Missing</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.map((r) => (
                <tr key={r.account.id}>
                  <td className="px-4 py-2.5 whitespace-nowrap">{r.customer}</td>
                  <td className="px-4 py-2.5 whitespace-nowrap">
                    <div className="font-mono text-xs">{r.account.iban_or_number}</div>
                    {r.account.institution && <div className="text-xs text-muted-foreground">{r.account.institution}</div>}
                    {canManage && <Link to={`/client/${r.account.client_id}?tab=overview`} className="text-xs text-primary hover:underline">Manage accounts</Link>}
                  </td>
                  <td className="px-4 py-2.5"><CoverageStrip cells={r.cells} /></td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{r.missing}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}