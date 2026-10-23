import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import InlineError from '@/components/shared/InlineError';
import IdentifierColumn from '@/components/tm/counterparty/IdentifierColumn';
import MergeHistory from '@/components/tm/counterparty/MergeHistory';
import MergeDialog from '@/components/tm/counterparty/MergeDialog';
import ReasonDialog from '@/components/tm/counterparty/ReasonDialog';
import CounterpartyTransactions from '@/components/tm/counterparty/CounterpartyTransactions';
import LinkCounterpartyDialog from '@/components/tm/counterparty/LinkCounterpartyDialog';
import { base44 } from '@/api/base44Client';
import { useRefLabels } from '@/lib/refs';
import { toClient } from '@/lib/routes';
import { useTenant } from '@/lib/tenantContext';
import { isFeatureEnabled } from '@/lib/featureFlags';
import { hasPermission } from '@/lib/permissions';
import { fetchCounterparties, unmergeCounterparty, isLowConfidence } from '@/lib/tmCounterparty';
import { Loader2, GitMerge, Link2 } from 'lucide-react';

const SCREEN_LABEL = { not_screened: 'Not screened', clear: 'Clear', potential_match: 'Potential match', confirmed_match: 'Confirmed match' };

function Section({ title, children }) {
  return <section className="space-y-2"><h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</h3>{children}</section>;
}

/** Counterparty detail: identifiers, screening, linked clients, transactions, merge history, Merge into… / Unmerge. */
export default function CounterpartyDrawer({ counterpartyId, open, onOpenChange }) {
  const { currentUser, tenant } = useTenant();
  const qc = useQueryClient();
  const tenantId = currentUser?.tenant_id;
  const canWork = isFeatureEnabled(tenant, 'tm_core') && hasPermission(currentUser?.app_role, 'tmWorkCase');
  const [merging, setMerging] = useState(false);
  const [unmerging, setUnmerging] = useState(null); // counterparty id to restore
  const [linking, setLinking] = useState(false);
  const [unlinking, setUnlinking] = useState(false);
  const key = ['counterparty', tenantId, counterpartyId];

  const { data, isLoading, error, refetch } = useQuery({ queryKey: key, enabled: open && !!tenantId, queryFn: () => fetchCounterparties({ id: counterpartyId }) });
  const cp = data?.counterparty;
  const linkRefs = [cp?.client_id && `client:${cp.client_id}`].filter(Boolean);
  const linkLabels = useRefLabels(linkRefs);
  const { data: linkedParty } = useQuery({
    queryKey: ['related-party', cp?.related_party_id],
    enabled: !!cp?.related_party_id && !!tenantId,
    queryFn: async () => { const r = await base44.entities.RelatedParty.filter({ tenant_id: tenantId, id: cp.related_party_id }, undefined, 1); return (Array.isArray(r) ? r : r?.items || [])[0] || null; },
  });
  const isLinked = !!(cp?.client_id || cp?.related_party_id);
  const refresh = async () => {
    await qc.invalidateQueries({ queryKey: ['counterparty'] });
    qc.invalidateQueries({ queryKey: ['counterparty-txns'] });
    qc.invalidateQueries({ queryKey: ['client-counterparties'] });
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-xl">
        <SheetHeader><SheetTitle>{cp?.display_name || 'Counterparty'}</SheetTitle></SheetHeader>
        {isLoading && <div className="flex justify-center py-12"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>}
        {error && <InlineError className="mt-4" message={error?.response?.data?.error || 'Could not load the counterparty.'} onRetry={refetch} />}
        {cp && (
          <div className="mt-4 space-y-5">
            {cp.merged_into && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                Merged into {data.related[cp.merged_into]?.display_name || 'another counterparty'}. Its transactions now belong there; use Unmerge in the history to restore it.
              </div>
            )}
            <IdentifierColumn cp={cp} />
            <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
              {[['Transactions', cp.transaction_count], ['Total', `${cp.total_amount.toLocaleString()} ${tenant?.tm_reporting_currency || ''}`], ['Clients', cp.linked_clients], ['Last seen', cp.last_seen ? cp.last_seen.slice(0, 10) : '—']].map(([l, v]) => (
                <div key={l} className="rounded-lg bg-muted/40 p-2"><div className="text-muted-foreground">{l}</div><div className="font-medium">{v}</div></div>
              ))}
            </div>
            {isLowConfidence(cp.lowest_confidence) && <div className="text-xs text-amber-700">Lowest match confidence {cp.lowest_confidence}: some transactions were matched by name only.</div>}
            <Section title="Screening">
              <div className="text-xs">{SCREEN_LABEL[cp.screening_status] || cp.screening_status}{cp.last_screened_at ? ` · ${cp.last_screened_at.slice(0, 10)}` : ''}</div>
              {(cp.screening_hit_ids || []).length > 0 && <Link to="/monitoring" className="text-xs text-primary hover:underline">{cp.screening_hit_ids.length} screening hit(s): open monitoring alerts</Link>}
            </Section>
            <Section title={`Linked clients (${data.linked_clients.length})`}>
              {data.linked_clients.length === 0 && <p className="text-xs text-muted-foreground">None.</p>}
              <ul className="flex flex-wrap gap-1.5">{data.linked_clients.map((c) => <li key={c.id}><Link to={`/client/${c.id}`} className="rounded-full bg-muted px-2 py-0.5 text-xs hover:underline">{c.full_name || c.id}</Link></li>)}</ul>
            </Section>
            {isFeatureEnabled(tenant, 'tm_core') && (
              <Section title="Identified as">
                {!isLinked && <p className="text-xs text-muted-foreground">Not linked to a customer or related party.</p>}
                {cp.client_id && <div className="text-xs">Customer: <Link to={toClient(cp.client_id)} className="font-medium text-primary hover:underline">{linkLabels?.[`client:${cp.client_id}`]?.label || 'Open customer'}</Link></div>}
                {cp.related_party_id && <div className="text-xs">Related party: <span className="font-medium">{linkedParty?.full_name || '…'}</span>{linkedParty?.role_in_relationship ? ` · ${linkedParty.role_in_relationship}` : ''}</div>}
                {canWork && (
                  <div className="flex gap-2">
                    <Button size="sm" variant="outline" className="gap-1.5" onClick={() => setLinking(true)}><Link2 className="h-3.5 w-3.5" /> {isLinked ? 'Change link' : 'Link to related party / customer'}</Button>
                    {isLinked && <Button size="sm" variant="ghost" onClick={() => setUnlinking(true)}>Unlink</Button>}
                  </div>
                )}
              </Section>
            )}
            <Section title="Latest transactions"><CounterpartyTransactions tenantId={tenantId} counterpartyId={cp.id} /></Section>
            <Section title="Merge history"><MergeHistory cp={cp} related={data.related} canWork={canWork} onUnmerge={setUnmerging} /></Section>
            {canWork && !cp.merged_into && <Button variant="outline" className="gap-2" onClick={() => setMerging(true)}><GitMerge className="h-4 w-4" /> Merge into…</Button>}
          </div>
        )}
        {merging && cp && <MergeDialog source={cp} tenantId={tenantId} onOpenChange={setMerging} onDone={refresh} />}
        {linking && cp && <LinkCounterpartyDialog cp={cp} tenantId={tenantId} onOpenChange={setLinking} onDone={refresh} />}
        {unlinking && cp && (
          <ReasonDialog
            title="Unlink counterparty" confirmLabel="Unlink" onOpenChange={setUnlinking}
            description="The counterparty is no longer treated as this customer or related party. The change is recorded in its link history."
            onConfirm={async (reason) => { await base44.functions.invoke('linkCounterparty', { action: 'unlink', counterparty_id: cp.id, reason }); await refresh(); }}
          />
        )}
        {unmerging && (
          <ReasonDialog
            title="Unmerge counterparty" confirmLabel="Unmerge" onOpenChange={(o) => !o && setUnmerging(null)}
            description="The transactions that were moved are restored to the counterparty and customer risk is recomputed."
            onConfirm={async (reason) => { await unmergeCounterparty({ counterpartyId: unmerging, reason }); await refresh(); }}
          />
        )}
      </SheetContent>
    </Sheet>
  );
}