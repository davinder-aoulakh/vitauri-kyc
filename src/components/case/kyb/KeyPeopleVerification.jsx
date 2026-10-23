import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { toast } from '@/components/ui/use-toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Copy, Loader2, Send } from 'lucide-react';
import { cn } from '@/lib/utils';
import { sendCustomerEmail } from '@/lib/tippingOff';

export const keyRoleKind = (role) => (/ubo|beneficial/i.test(role || '') ? 'UBO' : /director|board/i.test(role || '') ? 'Director' : null);
const STATUS_CLS = {
  Verified: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  Pending_Verification: 'bg-amber-50 text-amber-700 border-amber-200',
  Rejected: 'bg-red-50 text-red-700 border-red-200',
};

/** UBOs and directors of an organisation with their own Didit ID verification (one portal link per person). */
export default function KeyPeopleVerification({ client, kycCase, tenant, people, requests, onChanged }) {
  const [emails, setEmails] = useState({});
  const [busy, setBusy] = useState(null);
  const [links, setLinks] = useState({});

  const send = async (p) => {
    setBusy(p.id);
    try {
      const email = (emails[p.id] || '').trim();
      const res = await base44.functions.invoke('sendKeyPersonIdv', { client_id: client.id, related_party_id: p.id, kyc_case_id: kycCase?.id, email });
      const data = res?.data;
      if (data?.error) throw new Error(data.error);
      const link = `${window.location.origin}/portal/${data.access_token}`;
      setLinks((l) => ({ ...l, [p.id]: link }));
      if (email) {
        await sendCustomerEmail({
          tenant,
          clientId: client.id,
          caseId: kycCase?.id,
          to: email,
          subject: `Identity verification for ${client.full_name}`,
          body: `<p>Dear ${p.full_name},</p><p>As ${p.role || 'a key person'} of ${client.full_name}, ${tenant?.name || 'we'} need you to verify your identity. It takes a few minutes with your ID document and phone camera.</p><p><a href="${link}">Open your secure verification link</a></p>`,
        });
        toast({ title: `Verification link sent to ${email}` });
      } else {
        toast({ title: 'Verification link created', description: 'Copy the link and send it to the person.' });
      }
      onChanged?.();
    } catch (e) {
      toast({ title: 'Could not request verification', description: e?.response?.data?.error || e.message, variant: 'destructive' });
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="rounded-xl border border-border bg-card p-4 space-y-3">
      <div>
        <h3 className="text-sm font-semibold">Key people — identity verification</h3>
        <p className="text-xs text-muted-foreground">Each UBO and director verifies their own identity with Didit through a personal link. Results update the related party, not the company.</p>
      </div>
      {people.length === 0 ? (
        <p className="text-xs text-muted-foreground">No UBOs or directors recorded. Add them in Related Parties or from the registry list above.</p>
      ) : (
        <div className="divide-y divide-border">
          {people.map((p) => {
            const req = requests.find((r) => r.related_party_id === p.id);
            const item = req?.items?.[0];
            return (
              <div key={p.id} className="py-2.5 space-y-1.5">
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="font-medium">{p.full_name}</span>
                  <span className="text-xs text-muted-foreground">{p.kind}{p.ownership_percentage != null ? ` · ${p.ownership_percentage}%` : ''}</span>
                  <span className={cn('ml-auto text-[11px] px-2 py-0.5 rounded-full border', STATUS_CLS[p.verification_status] || 'bg-muted text-muted-foreground border-border')}>
                    {String(p.verification_status || 'Unverified').replace(/_/g, ' ')}
                  </span>
                </div>
                {req && (
                  <div className="text-xs text-muted-foreground">
                    Request {req.status}{item?.didit_session_status ? ` · Didit: ${item.didit_session_status}` : ''}{item?.idv_status ? ` · Result: ${item.idv_status}` : ''}{req.recipient_email ? ` · ${req.recipient_email}` : ''}
                  </div>
                )}
                {p.verification_status !== 'Verified' && (
                  <div className="flex flex-wrap items-center gap-2">
                    <Input value={emails[p.id] ?? ''} onChange={(e) => setEmails((m) => ({ ...m, [p.id]: e.target.value }))} placeholder="Email (optional)" className="h-8 text-xs w-56" />
                    <Button size="sm" className="h-8 gap-1.5 text-xs" disabled={busy === p.id || p.party_type === 'ORG'} onClick={() => send(p)}
                      title={p.party_type === 'ORG' ? 'Corporate owners are verified with business verification' : ''}>
                      {busy === p.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
                      {req ? 'Resend link' : 'Send ID verification'}
                    </Button>
                    {links[p.id] && (
                      <Button size="sm" variant="ghost" className="h-8 gap-1 text-xs" onClick={() => { navigator.clipboard?.writeText(links[p.id]); toast({ title: 'Link copied' }); }}>
                        <Copy className="w-3.5 h-3.5" /> Copy link
                      </Button>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
