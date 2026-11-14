import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import InlineError from '@/components/shared/InlineError';
import { Loader2, Plus, X } from 'lucide-react';
import { useTenant } from '@/lib/tenantContext';
import { isFeatureEnabled } from '@/lib/featureFlags';

const ACCOUNT_TYPES = [['own', 'Own account'], ['external_psd2', 'External account (PSD2)'], ['joint', 'Joint account'], ['business', 'Business account']];

const blank = { iban_or_number: '', institution: '', bic: '', currency: '', holder_name: '', source_type: 'manual', is_customer_owned: true, expected_frequency: 'daily', opened_at: '' };
const pick = (a) => Object.fromEntries(Object.keys(blank).map((k) => [k, a?.[k] ?? blank[k]]));

function Field({ label, children }) {
  return <div><Label className="text-xs mb-1 block">{label}</Label>{children}</div>;
}

/** Add (account null) or edit an account. Mount with a key per account so the form resets. */
export default function AccountFormDialog({ open, onOpenChange, clientId, account, onSaved }) {
  const { tenant } = useTenant();
  const v2 = isFeatureEnabled(tenant, 'aml_nav_v2');
  const [form, setForm] = useState(pick(account));
  const [accountType, setAccountType] = useState(account?.account_type || '');
  const [holders, setHolders] = useState(() => (account?.holders || []).map((h) => ({ name: h.name || '', role: h.role || '', client_id: h.client_id, related_party_id: h.related_party_id })));
  const setHolder = (i, k, v) => setHolders((hs) => hs.map((h, j) => (j === i ? { ...h, [k]: v } : h)));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const sel = (k) => (v) => setForm((f) => ({ ...f, [k]: v }));

  const save = async () => {
    setBusy(true); setError('');
    try {
      const extra = v2 ? { account_type: accountType || undefined, holders: holders.filter((h) => h.name.trim()) } : {};
      const payload = account ? { action: 'update', id: account.id, ...form, ...extra } : { action: 'create', client_id: clientId, ...form, ...extra };
      await base44.functions.invoke('manageBankAccount', payload);
      onSaved();
      onOpenChange(false);
    } catch (e) {
      setError(e?.response?.data?.error || e?.message || 'Could not save the account.');
    } finally { setBusy(false); }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>{account ? 'Edit bank account' : 'Add bank account'}</DialogTitle></DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2"><Field label="IBAN or account number"><Input value={form.iban_or_number} onChange={set('iban_or_number')} className="font-mono" /></Field></div>
          <Field label="Institution"><Input value={form.institution} onChange={set('institution')} /></Field>
          <Field label="BIC"><Input value={form.bic} onChange={set('bic')} /></Field>
          <Field label="Currency"><Input value={form.currency} onChange={set('currency')} placeholder="EUR" maxLength={3} /></Field>
          <Field label="Holder name"><Input value={form.holder_name} onChange={set('holder_name')} /></Field>
          <Field label="Source">
            <Select value={form.source_type} onValueChange={sel('source_type')}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{['api', 'psd2', 'upload', 'manual'].map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
            </Select>
          </Field>
          <Field label="Expected data">
            <Select value={form.expected_frequency} onValueChange={sel('expected_frequency')}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{['daily', 'weekly', 'monthly'].map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
            </Select>
          </Field>
          <Field label="Opened on"><Input type="date" value={form.opened_at} onChange={set('opened_at')} /></Field>
          {v2 && (
            <>
              <Field label="Account type">
                <Select value={accountType || 'none'} onValueChange={(v) => setAccountType(v === 'none' ? '' : v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Not set</SelectItem>
                    {ACCOUNT_TYPES.map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}
                  </SelectContent>
                </Select>
              </Field>
              <div className="sm:col-span-2">
                <Label className="text-xs mb-1 block">Holders <span className="font-normal text-muted-foreground">(joint and business accounts can have several)</span></Label>
                <div className="space-y-1.5">
                  {holders.map((h, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <Input value={h.name} onChange={(e) => setHolder(i, 'name', e.target.value)} placeholder="Name" aria-label={`Holder ${i + 1} name`} />
                      <Input value={h.role} onChange={(e) => setHolder(i, 'role', e.target.value)} placeholder="Role (e.g. co-holder, UBO)" className="max-w-[45%]" aria-label={`Holder ${i + 1} role`} />
                      <Button type="button" variant="ghost" size="icon" className="h-8 w-8 flex-shrink-0" onClick={() => setHolders((hs) => hs.filter((_, j) => j !== i))} aria-label={`Remove holder ${i + 1}`}><X className="h-4 w-4" /></Button>
                    </div>
                  ))}
                  {holders.length < 10 && (
                    <Button type="button" variant="outline" size="sm" className="h-7 gap-1 text-xs" onClick={() => setHolders((hs) => [...hs, { name: '', role: '' }])}><Plus className="h-3.5 w-3.5" /> Add holder</Button>
                  )}
                </div>
              </div>
            </>
          )}
          <div className="flex items-center gap-2 sm:col-span-2">
            <Switch checked={form.is_customer_owned} onCheckedChange={sel('is_customer_owned')} />
            <Label className="text-xs">Owned by the customer (transfers to it count as own transfers)</Label>
          </div>
        </div>
        {error && <InlineError message={error} />}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>Cancel</Button>
          <Button onClick={save} disabled={busy || !form.iban_or_number.trim()} className="gap-2">
            {busy && <Loader2 className="h-4 w-4 animate-spin" />} Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}