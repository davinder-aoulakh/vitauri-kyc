import React, { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { base44 } from '@/api/base44Client';
import { useTenant } from '@/lib/tenantContext';
import { useTenantClients } from '@/hooks/useTenantData';
import EmptyState from '@/components/shared/EmptyState';
import EdrTriggerActions from '@/components/client/overview/EdrTriggerActions';
import { Loader2, Zap } from 'lucide-react';

const TRIGGER_LABEL = {
  ubo_change: 'UBO change', director_change: 'Director change', business_activity_change: 'Business activity change',
  country_change: 'Country change', screening_hit: 'Confirmed screening hit', risk_band_rise: 'Risk band rise',
  profile_breach: 'Profile breach', tm_case: 'TM case',
};
const list = (res) => (Array.isArray(res) ? res : res?.items || []);

/** Review Planner 'EDR proposals' view: proposed EdrTriggers across the tenant's clients. */
export default function EdrProposalsList() {
  const { currentUser } = useTenant();
  const tenantId = currentUser?.tenant_id;
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ['edrProposals', tenantId],
    enabled: !!tenantId,
    queryFn: async () => list(await base44.entities.EdrTrigger.filter({ tenant_id: tenantId, status: 'proposed' }, { sort: '-created_date', limit: 500 })),
  });
  const { data: clients } = useTenantClients(tenantId);
  const clientsById = useMemo(() => new Map((clients || []).map((c) => [c.id, c])), [clients]);
  const rows = q.data || [];

  return (
    <div className="bg-card border border-border rounded-xl overflow-hidden">
      {q.isLoading ? <div className="flex items-center justify-center py-16"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>
        : rows.length === 0 ? <EmptyState icon={Zap} title="No EDR proposals" description="Proposals appear when the KYC file or behaviour of an approved client changes." />
        : (
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-muted/40 border-b border-border text-xs text-muted-foreground uppercase tracking-wide">
                <th className="text-left px-4 py-2.5">Client</th>
                <th className="text-left px-4 py-2.5">Trigger</th>
                <th className="text-left px-4 py-2.5">Detail</th>
                <th className="text-left px-4 py-2.5">Proposed</th>
                <th className="px-4 py-2.5" />
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.map((t) => (
                <tr key={t.id} className="align-top">
                  <td className="px-4 py-3">
                    <Link to={`/client/${t.client_id}?tab=overview`} className="text-primary hover:underline font-medium text-xs">{clientsById.get(t.client_id)?.full_name || 'Client'}</Link>
                  </td>
                  <td className="px-4 py-3 text-xs font-medium">{TRIGGER_LABEL[t.trigger_type] || t.trigger_type}</td>
                  <td className="px-4 py-3 text-xs text-muted-foreground max-w-md">{t.after?.summary || '—'}</td>
                  <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">{t.created_date ? format(new Date(t.created_date), 'd MMM yyyy') : '—'}</td>
                  <td className="px-4 py-3"><EdrTriggerActions trigger={t} onDone={() => qc.invalidateQueries({ queryKey: ['edrProposals', tenantId] })} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
    </div>
  );
}
