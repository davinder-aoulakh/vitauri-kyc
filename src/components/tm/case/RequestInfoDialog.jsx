import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Loader2, Copy } from 'lucide-react';
import InlineError from '@/components/shared/InlineError';

const DEFAULT_ITEMS = 'Source of funds documentation\nSupporting documents for the flagged transactions';

export default function RequestInfoDialog({ open, onOpenChange, run, client, tenant }) {
  const [items, setItems] = useState(DEFAULT_ITEMS);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);

  const send = async () => {
    setBusy(true); setError('');
    const res = await run('request_info', { items: items.split('\n').filter((s) => s.trim()), message }, { success: 'Request created', fail: 'Request blocked' });
    if (!res) { setBusy(false); setError('The request could not be created. See the message above.'); return; }
    const link = `${window.location.origin}/portal/${res.access_token}`;
    let emailed = false;
    if (client?.primary_contact_email) {
      try {
        await base44.integrations.Core.SendEmail({
          from_name: tenant?.email_from_name || tenant?.name || 'Compliance Team',
          to: client.primary_contact_email,
          subject: `Information needed — ${tenant?.name || 'your account'}`,
          body: `<p>Dear ${client.full_name},</p><p>${message || 'We need some additional information about your account.'}</p><p><a href="${link}">Open your secure portal</a></p>`,
        });
        await base44.entities.OutreachRequest.update(res.outreach_id, { status: 'Sent' });
        emailed = true;
      } catch { emailed = false; }
    }
    setResult({ link, emailed });
    setBusy(false);
  };

  const close = (v) => { if (!v) setResult(null); onOpenChange(v); };

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Request source of funds</DialogTitle>
          <DialogDescription>Creates an outreach request for {client?.full_name || 'the client'} in the existing client portal.</DialogDescription>
        </DialogHeader>
        {result ? (
          <div className="space-y-3 text-sm">
            <p>{result.emailed ? 'Email sent to the client.' : 'Request saved as a draft. The email was not sent, so share the link yourself.'}</p>
            <div className="flex gap-2">
              <Input readOnly value={result.link} className="text-xs font-mono" />
              <Button variant="outline" size="icon" onClick={() => navigator.clipboard.writeText(result.link)}><Copy className="w-4 h-4" /></Button>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <div><Label className="text-xs">Items to request (one per line)</Label><Textarea value={items} onChange={(e) => setItems(e.target.value)} className="min-h-20 text-sm" /></div>
            <div><Label className="text-xs">Covering message (optional)</Label><Textarea value={message} onChange={(e) => setMessage(e.target.value)} className="min-h-16 text-sm" /></div>
            {error && <InlineError message={error} />}
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => close(false)}>{result ? 'Close' : 'Cancel'}</Button>
          {!result && <Button onClick={send} disabled={busy || !items.trim()}>{busy && <Loader2 className="w-4 h-4 animate-spin" />} Send request</Button>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}