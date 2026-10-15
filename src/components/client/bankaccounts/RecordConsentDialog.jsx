import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import InlineError from '@/components/shared/InlineError';
import { Loader2 } from 'lucide-react';

/** Record a PSD2 consent for an account; creates the connection first when the account has none. Mount with a key per account. */
export default function RecordConsentDialog({ account, connection, onOpenChange, onDone }) {
  const [consentId, setConsentId] = useState('');
  const [granted, setGranted] = useState(new Date().toISOString().slice(0, 10));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async () => {
    setBusy(true); setError('');
    try {
      let id = connection?.id;
      if (!id) {
        const res = await base44.functions.invoke('manageBankConnection', { action: 'create', bank_account_id: account.id, partner: 'manual' });
        id = (res?.data ?? res).connection.id;
      }
      await base44.functions.invoke('manageBankConnection', { action: 'record_consent', id, consent_id: consentId, consent_granted_at: `${granted}T00:00:00.000Z` });
      onDone();
      onOpenChange(false);
    } catch (e) {
      setError(e?.response?.data?.error || e?.message || 'Could not record the consent.');
    } finally { setBusy(false); }
  };

  return (
    <Dialog open={!!account} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>Record consent for {account?.iban_or_number}</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div><Label className="text-xs mb-1 block">Consent ID from the partner</Label><Input value={consentId} onChange={(e) => setConsentId(e.target.value)} className="font-mono" /></div>
          <div><Label className="text-xs mb-1 block">Consent granted on</Label><Input type="date" value={granted} max={new Date().toISOString().slice(0, 10)} onChange={(e) => setGranted(e.target.value)} /></div>
          <p className="text-xs text-muted-foreground">Re-authentication falls due 180 days after the grant date.</p>
        </div>
        {error && <InlineError message={error} />}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>Cancel</Button>
          <Button onClick={submit} disabled={busy || !consentId.trim() || !granted} className="gap-2">
            {busy && <Loader2 className="h-4 w-4 animate-spin" />} Record consent
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}