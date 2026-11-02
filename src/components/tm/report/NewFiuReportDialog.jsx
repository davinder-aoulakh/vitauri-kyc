import React, { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { format } from 'date-fns';
import { base44 } from '@/api/base44Client';
import { toast } from '@/components/ui/use-toast';
import { errorMessage } from '@/lib/tmAlerts';
import { FIU_TYPES, enabledTypes } from '@/lib/fiuTypes';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { AlertTriangle, ChevronsUpDown, Loader2 } from 'lucide-react';

const CW = ['cw', 'cuw', 'curacao', 'curaçao'];
const profileFor = (client) => {
  const c = String((client?.client_type === 'ORG' ? client?.registered_country : client?.country_of_residence) || '').toLowerCase();
  return CW.includes(c) ? 'CW' : 'NL';
};
const list = (res) => (Array.isArray(res) ? res : res?.items || []);

/** "New FIU report": customer, FIU, report type (the profile's enabled types) and the transactions to report. */
export default function NewFiuReportDialog({ open, onOpenChange, tenantId, profiles = [], clients = [], defaultClientId, defaultType, defaultTransactionIds = [] }) {
  const navigate = useNavigate();
  const [clientId, setClientId] = useState(defaultClientId || '');
  const [pickOpen, setPickOpen] = useState(false);
  const [code, setCode] = useState('');
  const [type, setType] = useState(defaultType || '');
  const [selected, setSelected] = useState(new Set(defaultTransactionIds));
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setClientId(defaultClientId || ''); setType(defaultType || ''); setSelected(new Set(defaultTransactionIds)); setCode('');
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const client = clients.find((c) => c.id === clientId);
  const effectiveCode = code || (client ? profileFor(client) : profiles[0]?.code || '');
  const fiu = profiles.find((p) => p.code === effectiveCode);
  const types = enabledTypes(fiu);
  const meta = FIU_TYPES[type];

  const txQ = useQuery({
    queryKey: ['fiuNewReportTxns', tenantId, clientId],
    enabled: open && !!tenantId && !!clientId,
    queryFn: async () => list(await base44.entities.Transaction.filter({ tenant_id: tenantId, client_id: clientId }, { sort: '-executed_at', limit: 100 })),
  });
  const txns = useMemo(() => txQ.data || [], [txQ.data]);
  const toggle = (id) => setSelected((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const needsTxns = meta?.kind === 'transaction';
  const chosen = txns.filter((t) => selected.has(t.id)).map((t) => t.id);
  const canCreate = !!client && !!type && !!fiu && (!needsTxns || chosen.length > 0) && !busy;

  const create = async () => {
    setBusy(true);
    try {
      const res = (await base44.functions.invoke('prepareFiuReport', {
        client_id: clientId, report_type: type, transaction_ids: chosen, fiu_profile_code: effectiveCode,
      }))?.data || {};
      if (res.error) throw new Error(res.error);
      toast({ title: `FIU report ${res.report_ref} created`, description: res.status === 'draft' ? 'Saved as a draft for review.' : 'Ready for review.' });
      onOpenChange(false);
      navigate(`/tm/report/${res.report_id}`);
    } catch (e) {
      toast({ variant: 'destructive', title: 'Could not create the report', description: errorMessage(e) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>New FIU report</DialogTitle>
          <DialogDescription>Choose the customer, the report type and the transactions. The report starts as a draft and needs four-eyes approval.</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-[1fr_12rem]">
            <div className="space-y-1">
              <div className="text-xs font-medium">Customer</div>
              <Popover open={pickOpen} onOpenChange={setPickOpen}>
                <PopoverTrigger asChild>
                  <Button variant="outline" role="combobox" className="w-full justify-between h-9 text-sm font-normal">
                    <span className="truncate">{client?.full_name || 'Select a customer'}</span>
                    <ChevronsUpDown className="w-3.5 h-3.5 opacity-50" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="p-0 w-[--radix-popover-trigger-width]" align="start">
                  <Command>
                    <CommandInput placeholder="Search customers…" />
                    <CommandList className="max-h-64">
                      <CommandEmpty>No customer found.</CommandEmpty>
                      <CommandGroup>
                        {clients.filter((c) => !c.is_deleted).map((c) => (
                          <CommandItem key={c.id} value={`${c.full_name} ${c.id}`} onSelect={() => { setClientId(c.id); setSelected(new Set()); setPickOpen(false); }}>
                            <span className="truncate">{c.full_name}</span>
                            <span className="ml-auto text-[10px] text-muted-foreground">{c.client_type}</span>
                          </CommandItem>
                        ))}
                      </CommandGroup>
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
            </div>
            <div className="space-y-1">
              <div className="text-xs font-medium">FIU</div>
              <Select value={effectiveCode} onValueChange={setCode}>
                <SelectTrigger className="h-9 text-sm"><SelectValue placeholder="FIU" /></SelectTrigger>
                <SelectContent>{profiles.map((p) => <SelectItem key={p.code} value={p.code}>{p.name || p.code}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          </div>
          {!profiles.length && <p className="text-xs text-red-700">No FIU profile is configured. Load the FIU profiles in Tenant Config first.</p>}

          <div className="space-y-1">
            <div className="text-xs font-medium">Report type</div>
            <div role="radiogroup" className="grid gap-2 sm:grid-cols-2">
              {types.map((t) => (
                <button key={t} type="button" role="radio" aria-checked={type === t} onClick={() => setType(t)}
                  className={cn('text-left rounded-lg border px-3 py-2 transition-colors', type === t ? 'border-primary bg-primary/5 ring-1 ring-primary' : 'border-border hover:bg-muted/40')}>
                  <div className="text-sm font-medium"><span className="font-mono text-xs mr-1.5">{t}</span>{FIU_TYPES[t].label}</div>
                  <div className="text-[11px] text-muted-foreground">{FIU_TYPES[t].hint}</div>
                </button>
              ))}
            </div>
          </div>

          {type === 'TFR' && (
            <div className="flex gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-900">
              <AlertTriangle className="w-4 h-4 flex-shrink-0" />
              <span>A Terrorist Financing Report is filed without delay. Customer communications are locked at once. Assess an asset freeze; Vitauri does not freeze assets automatically.</span>
            </div>
          )}

          {client && (
            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <div className="text-xs font-medium">Transactions {needsTxns ? '(at least one)' : '(optional)'}</div>
                <div className="text-[11px] text-muted-foreground">{chosen.length} selected · last 100 shown</div>
              </div>
              <div className="max-h-60 overflow-y-auto rounded-lg border border-border divide-y divide-border">
                {txQ.isLoading ? <div className="flex justify-center py-6"><Loader2 className="w-4 h-4 animate-spin" /></div>
                  : !txns.length ? <p className="px-3 py-4 text-xs text-muted-foreground">No transactions for this customer.</p>
                  : txns.map((t) => (
                    <label key={t.id} className="flex items-center gap-3 px-3 py-1.5 text-xs cursor-pointer hover:bg-muted/30">
                      <Checkbox checked={selected.has(t.id)} onCheckedChange={() => toggle(t.id)} aria-label={`Select transaction ${t.id}`} />
                      <span className="w-24 text-muted-foreground">{t.executed_at ? format(new Date(t.executed_at), 'd MMM yyyy') : '—'}</span>
                      <span className="w-28 tabular-nums text-right">{t.direction === 'outbound' ? '−' : ''}{Number(t.amount || 0).toLocaleString()} {t.currency}</span>
                      <span className="flex-1 truncate">{t.counterparty_name || t.description_raw || '—'}</span>
                      <span className="text-muted-foreground">{t.counterparty_country || ''}</span>
                      {t.category && <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted">{String(t.category).replace(/_/g, ' ')}</span>}
                    </label>
                  ))}
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button disabled={!canCreate} onClick={create}>{busy && <Loader2 className="w-4 h-4 animate-spin" />} Create draft</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
