import React, { useEffect, useState } from 'react';
import { base44 } from '@/api/base44Client';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

// Client picker (when no client is fixed) + optional bank account. Value 'auto' = detect from the statement.
export default function StatementTargetPicker({ tenantId, clients, clientId, onClientChange, accountId, onAccountChange, lockClient, disabled }) {
  const [accounts, setAccounts] = useState([]);

  useEffect(() => {
    let live = true;
    setAccounts([]);
    if (!clientId || !tenantId) return undefined;
    base44.entities.BankAccount.filter({ tenant_id: tenantId, client_id: clientId }).then((list) => { if (live) setAccounts(list || []); });
    return () => { live = false; };
  }, [clientId, tenantId]);

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <div>
        <Label className="text-xs font-medium mb-1.5 block">Client</Label>
        <Select value={clientId || ''} onValueChange={(v) => { onClientChange(v); onAccountChange('auto'); }} disabled={disabled || lockClient}>
          <SelectTrigger className="h-9 text-sm"><SelectValue placeholder="Select a client" /></SelectTrigger>
          <SelectContent>
            {(clients || []).map((c) => <SelectItem key={c.id} value={c.id}>{c.full_name}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      <div>
        <Label className="text-xs font-medium mb-1.5 block">Bank account <span className="text-muted-foreground font-normal">(optional)</span></Label>
        <Select value={accountId || 'auto'} onValueChange={onAccountChange} disabled={disabled || !clientId}>
          <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="auto">Detect from statement</SelectItem>
            {accounts.map((a) => <SelectItem key={a.id} value={a.id}>{a.iban_or_number}{a.institution ? ` · ${a.institution}` : ''}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}