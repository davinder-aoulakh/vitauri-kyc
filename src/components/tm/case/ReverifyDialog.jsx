import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Loader2, Copy, ExternalLink } from 'lucide-react';
import InlineError from '@/components/shared/InlineError';

export default function ReverifyDialog({ open, onOpenChange, run, client, tenantId }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [session, setSession] = useState(null);

  const start = async () => {
    setBusy(true); setError('');
    const res = await run('reverify_identity', {}, { fail: 'Re-verification blocked' });
    if (!res) { setBusy(false); setError('Identity re-verification could not be started.'); return; }
    const parts = (client?.full_name || '').split(' ');
    try {
      // Same call the portal's identity verification field makes.
      const out = await base44.functions.invoke('createDiditSession', {
        outreach_id: res.outreach_id, item_id: res.item_id, client_id: client.id, tenant_id: tenantId,
        portal_url: `${window.location.origin}/portal/${res.access_token}`, language: client.language || 'en',
        client_email: client.primary_contact_email || '', first_name: client.first_names || parts[0] || '',
        last_name: client.last_name || parts.slice(1).join(' '), idv_workflow_id: '',
      });
      const data = out?.data || out;
      if (data?.error || !data?.session_url) throw new Error(data?.error || 'Didit did not return a session link.');
      setSession(data.session_url);
    } catch (e) {
      setError(e?.message || 'Could not create the Didit session.');
    }
    setBusy(false);
  };

  const close = (v) => { if (!v) { setSession(null); setError(''); } onOpenChange(v); };

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Re-verify identity (Didit)</DialogTitle>
          <DialogDescription>Starts a new Didit identity check for {client?.full_name || 'the client'}. A passed check does not explain where the money came from.</DialogDescription>
        </DialogHeader>
        {session ? (
          <div className="space-y-3 text-sm">
            <p>Send this link to the client, or open it on their device.</p>
            <div className="flex gap-2">
              <Input readOnly value={session} className="text-xs font-mono" />
              <Button variant="outline" size="icon" onClick={() => navigator.clipboard.writeText(session)}><Copy className="w-4 h-4" /></Button>
              <Button variant="outline" size="icon" asChild><a href={session} target="_blank" rel="noopener noreferrer"><ExternalLink className="w-4 h-4" /></a></Button>
            </div>
          </div>
        ) : error ? <InlineError message={error} onRetry={start} /> : null}
        <DialogFooter>
          <Button variant="outline" onClick={() => close(false)}>{session ? 'Close' : 'Cancel'}</Button>
          {!session && <Button onClick={start} disabled={busy}>{busy && <Loader2 className="w-4 h-4 animate-spin" />} Start verification</Button>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}