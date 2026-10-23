import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import InlineError from '@/components/shared/InlineError';
import { Loader2 } from 'lucide-react';
import { errText } from '@/lib/tmCounterparty';

const asList = (r) => (Array.isArray(r) ? r : r?.items || []);
const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Link a counterparty to a tenant customer and/or a related party (UBO, director, related company). Mount only while open. */
export default function LinkCounterpartyDialog({ cp, tenantId, onOpenChange, onDone }) {
  const [term, setTerm] = useState(cp?.display_name || '');
  const [client, setClient] = useState(null);
  const [party, setParty] = useState(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const q = term.trim();

  const { data, isFetching } = useQuery({
    queryKey: ['cp-link-search', tenantId, q],
    enabled: !!tenantId && q.length >= 2,
    staleTime: 30000,
    queryFn: async () => {
      const name = { $regex: escape(q), $options: 'i' };
      const [clients, parties] = await Promise.all([
        base44.entities.Client.filter({ tenant_id: tenantId, full_name: name }, 'full_name', 8),
        base44.entities.RelatedParty.filter({ tenant_id: tenantId, full_name: name }, 'full_name', 8),
      ]);
      return { clients: asList(clients), parties: asList(parties) };
    },
  });

  const submit = async () => {
    setBusy(true); setError('');
    try {
      await base44.functions.invoke('linkCounterparty', { action: 'link', counterparty_id: cp.id, client_id: client?.id, related_party_id: party?.id, reason: reason.trim() });
      await onDone?.();
      onOpenChange(false);
    } catch (e) { setError(errText(e, 'Could not link the counterparty.')); } finally { setBusy(false); }
  };

  const Option = ({ item, selected, onPick, sub }) => (
    <li>
      <button type="button" onClick={() => onPick(selected ? null : item)} className={`w-full rounded-md border px-2 py-1.5 text-left text-xs ${selected ? 'border-primary bg-primary/5' : 'border-border hover:bg-muted/50'}`}>
        <span className="font-medium">{item.full_name}</span>{sub && <span className="text-muted-foreground"> · {sub}</span>}
      </button>
    </li>
  );

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>Link “{cp.display_name}”</DialogTitle></DialogHeader>
        <p className="text-sm text-muted-foreground">Link this counterparty to the customer and/or related party it represents. Their risk and alerts then show in the network view. The link is audited and can be removed.</p>
        <Input value={term} onChange={(e) => setTerm(e.target.value)} placeholder="Search by name" />
        {isFetching && <div className="flex justify-center py-2"><Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /></div>}
        {data && (
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <div className="mb-1 text-xs font-semibold text-muted-foreground">Customers</div>
              {data.clients.length === 0 ? <p className="text-xs text-muted-foreground">None found.</p> : (
                <ul className="space-y-1">{data.clients.map((c) => <Option key={c.id} item={c} selected={client?.id === c.id} onPick={setClient} sub={c.client_type} />)}</ul>
              )}
            </div>
            <div>
              <div className="mb-1 text-xs font-semibold text-muted-foreground">Related parties</div>
              {data.parties.length === 0 ? <p className="text-xs text-muted-foreground">None found.</p> : (
                <ul className="space-y-1">{data.parties.map((p) => <Option key={p.id} item={p} selected={party?.id === p.id} onPick={setParty} sub={p.role_in_relationship || p.party_type} />)}</ul>
              )}
            </div>
          </div>
        )}
        <Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} placeholder="Reason (required)" />
        {error && <InlineError message={error} />}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>Cancel</Button>
          <Button onClick={submit} disabled={busy || (!client && !party) || reason.trim().length < 5} className="gap-2">{busy && <Loader2 className="h-4 w-4 animate-spin" />} Link</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
