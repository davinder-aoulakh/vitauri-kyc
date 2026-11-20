// Guided conversation outreach: cost of registry and ID calls per month (OutreachAdapterCall, plan phase 10, AT 37).
// Read-only. tenantId is passed only from the Ops console; tenant users get their own tenant.
import React, { useEffect, useState } from 'react';
import { base44 } from '@/api/base44Client';
import { Loader2 } from 'lucide-react';

const eur = (n) => `€ ${Number(n || 0).toFixed(2)}`;

export default function AdapterCostTable({ tenantId = null, months = 3 }) {
  const [d, setD] = useState(null);
  const [err, setErr] = useState('');
  useEffect(() => {
    let live = true;
    base44.functions.invoke('manageOutreachConfig', { action: 'costs', months, ...(tenantId ? { tenant_id: tenantId } : {}) })
      .then((r) => { if (live) setD(r.data); })
      .catch((e) => { if (live) setErr(e?.response?.data?.error || e?.message || 'Not available'); });
    return () => { live = false; };
  }, [tenantId, months]);
  return (
    <div className="space-y-1 text-xs">
      <div className="font-semibold">Registry and ID calls (last {months} months)</div>
      {err ? <p className="text-muted-foreground">{err}</p> : !d ? <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /> : d.rows.length === 0 ? (
        <p className="text-muted-foreground">No calls yet.</p>
      ) : (
        <table className="w-full">
          <thead><tr className="border-b border-border text-left text-muted-foreground"><th className="py-1 pr-2 font-medium">Month</th><th className="py-1 pr-2 font-medium">Vendor</th><th className="py-1 pr-2 font-medium">Call</th><th className="py-1 pr-2 font-medium">Environment</th><th className="py-1 pr-2 text-right font-medium">Calls</th><th className="py-1 text-right font-medium">Cost</th></tr></thead>
          <tbody>
            {d.rows.map((r) => (
              <tr key={`${r.month}|${r.vendor}|${r.operation}|${r.environment}`} className="border-b border-border/60">
                <td className="py-1 pr-2">{r.month}</td><td className="py-1 pr-2">{r.vendor}</td><td className="py-1 pr-2">{r.operation}</td><td className="py-1 pr-2">{r.environment}</td>
                <td className="py-1 pr-2 text-right">{r.calls}{r.errors ? <span className="text-red-700"> ({r.errors} failed)</span> : null}</td><td className="py-1 text-right">{eur(r.cost_eur)}</td>
              </tr>
            ))}
            <tr><td colSpan={5} className="py-1 pr-2 text-right font-semibold">Total</td><td className="py-1 text-right font-semibold">{eur(d.total_eur)}</td></tr>
          </tbody>
        </table>
      )}
      <p className="text-[11px] text-muted-foreground">Costs come from the prices in the outreach settings (adapter costs); sandbox and test calls cost nothing.</p>
    </div>
  );
}
