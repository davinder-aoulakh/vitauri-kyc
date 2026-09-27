import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Loader2, Send } from 'lucide-react';

const CATEGORIES = ['finance', 'kyc', 'travel_rule', 'user_event', 'audit_trail_event', 'gambling_bet', 'gambling_limit_change', 'gambling_bonus_change'];
const FIAT_METHODS = ['bank_card', 'bank_account', 'ewallet', 'other'];
const CRYPTO_METHODS = ['crypto_wallet', 'unhosted_wallet'];

export default function TransactionForm({ clients, onCreated, onCancel }) {
  const [form, setForm] = useState({
    client_id: '', case_id: '', transaction_category: 'finance', direction: 'inbound',
    amount: '', currency_kind: 'fiat', currency: 'USD',
    counterparty_name: '', counterparty_account_id: '', counterparty_method_type: 'bank_account',
    subject_entity_type: 'person', subject_full_name: '',
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  function update(field, value) {
    setForm(f => {
      const next = { ...f, [field]: value };
      if (field === 'currency_kind') {
        next.currency = value === 'crypto' ? 'bitcoin:BTC' : 'USD';
        next.counterparty_method_type = value === 'crypto' ? 'crypto_wallet' : 'bank_account';
      }
      return next;
    });
  }

  const canSubmit = form.client_id && form.transaction_category && form.direction && form.amount &&
    form.currency && form.currency_kind && form.counterparty_name && form.counterparty_account_id && form.counterparty_method_type;

  async function handleSubmit() {
    if (!canSubmit) return;
    setSubmitting(true);
    setError('');
    try {
      const res = await base44.functions.invoke('createDiditTransaction', {
        client_id: form.client_id,
        case_id: form.case_id || null,
        transaction_category: form.transaction_category,
        direction: form.direction,
        amount: parseFloat(form.amount),
        currency: form.currency,
        currency_kind: form.currency_kind,
        counterparty_name: form.counterparty_name,
        counterparty_account_id: form.counterparty_account_id,
        counterparty_method_type: form.counterparty_method_type,
        subject_entity_type: form.subject_entity_type,
        subject_full_name: form.subject_full_name || undefined,
      });
      if (res?.data?.error) { setError(res.data.detail || res.data.error); setSubmitting(false); return; }
      onCreated();
    } catch (err) {
      setError(err?.response?.data?.error || err?.message || 'Failed to create transaction');
      setSubmitting(false);
    }
  }

  const methodOptions = form.currency_kind === 'crypto' ? CRYPTO_METHODS : FIAT_METHODS;

  return (
    <div className="space-y-4">
      {error && <div className="text-xs text-destructive bg-destructive/10 border border-destructive/30 rounded-lg px-3 py-2">{error}</div>}

      <div>
        <Label className="text-xs mb-1.5 block">Client *</Label>
        <Select value={form.client_id} onValueChange={v => update('client_id', v)}>
          <SelectTrigger className="h-9 text-sm"><SelectValue placeholder="Select client" /></SelectTrigger>
          <SelectContent>
            {clients.map(c => <SelectItem key={c.id} value={c.id}>{c.full_name}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      <div className="flex gap-2">
        {['fiat', 'crypto'].map(kind => (
          <button key={kind} type="button" onClick={() => update('currency_kind', kind)}
            className={`flex-1 py-2 rounded-full text-sm font-medium border transition-colors ${form.currency_kind === kind ? 'bg-primary text-primary-foreground border-primary' : 'border-input text-muted-foreground hover:bg-muted'}`}>
            {kind === 'fiat' ? 'Fiat' : 'Crypto'}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label className="text-xs mb-1.5 block">Direction *</Label>
          <Select value={form.direction} onValueChange={v => update('direction', v)}>
            <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="inbound">Inbound</SelectItem>
              <SelectItem value="outbound">Outbound</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-xs mb-1.5 block">Category *</Label>
          <Select value={form.transaction_category} onValueChange={v => update('transaction_category', v)}>
            <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
            <SelectContent>
              {CATEGORIES.map(c => <SelectItem key={c} value={c}>{c.replace(/_/g, ' ')}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label className="text-xs mb-1.5 block">Amount *</Label>
          <Input type="number" value={form.amount} onChange={e => update('amount', e.target.value)} placeholder="1000" className="h-9 text-sm" />
        </div>
        <div>
          <Label className="text-xs mb-1.5 block">{form.currency_kind === 'crypto' ? 'Currency (chain:ticker) *' : 'Currency (ISO 4217) *'}</Label>
          <Input value={form.currency} onChange={e => update('currency', e.target.value)}
            placeholder={form.currency_kind === 'crypto' ? 'bitcoin:BTC' : 'USD'} className="h-9 text-sm" />
        </div>
      </div>

      <div>
        <Label className="text-xs mb-1.5 block">Counterparty Name *</Label>
        <Input value={form.counterparty_name} onChange={e => update('counterparty_name', e.target.value)} placeholder="External Wallet / Bank" className="h-9 text-sm" />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label className="text-xs mb-1.5 block">Payment Method *</Label>
          <Select value={form.counterparty_method_type} onValueChange={v => update('counterparty_method_type', v)}>
            <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
            <SelectContent>
              {methodOptions.map(m => <SelectItem key={m} value={m}>{m.replace(/_/g, ' ')}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-xs mb-1.5 block">{form.currency_kind === 'crypto' ? 'Wallet Address *' : 'IBAN / Account No. *'}</Label>
          <Input value={form.counterparty_account_id} onChange={e => update('counterparty_account_id', e.target.value)}
            placeholder={form.currency_kind === 'crypto' ? '0x...' : 'NL00BANK0123456789'} className="h-9 text-sm" />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label className="text-xs mb-1.5 block">Subject Entity Type</Label>
          <Select value={form.subject_entity_type} onValueChange={v => update('subject_entity_type', v)}>
            <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="person">Person</SelectItem>
              <SelectItem value="company">Company</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-xs mb-1.5 block">Subject Full Name (optional)</Label>
          <Input value={form.subject_full_name} onChange={e => update('subject_full_name', e.target.value)} placeholder="Defaults to client name" className="h-9 text-sm" />
        </div>
      </div>

      <div className="flex justify-end gap-2 pt-2">
        <Button variant="outline" onClick={onCancel} disabled={submitting}>Cancel</Button>
        <Button onClick={handleSubmit} disabled={!canSubmit || submitting} className="gap-2">
          {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
          {submitting ? 'Screening…' : 'Submit for Screening'}
        </Button>
      </div>
    </div>
  );
}