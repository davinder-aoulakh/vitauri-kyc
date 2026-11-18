// Guided conversation outreach, staff side: the panel above the classic "Outreach & Documents" step (flag outreach_conversation).
// Lists the case's conversations and starts a new one through sendOutreachConversation. The link is shown once; it is never stored.
import React, { useCallback, useEffect, useState } from 'react';
import { base44 } from '@/api/base44Client';
import { hasPermission } from '@/lib/permissions';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { toast } from '@/components/ui/use-toast';
import { Copy, Loader2, MessagesSquare, Send } from 'lucide-react';
import { format } from 'date-fns';

const list = (r) => (Array.isArray(r) ? r : r?.items || []);
const fmt = (d) => { try { return d ? format(new Date(d), 'd MMM yyyy HH:mm') : '—'; } catch { return '—'; } };
const STATUS_TONE = {
  Sent: 'bg-sky-50 text-sky-800 border-sky-200', Opened: 'bg-violet-50 text-violet-800 border-violet-200', In_Progress: 'bg-amber-50 text-amber-900 border-amber-200',
  Submitted: 'bg-emerald-50 text-emerald-800 border-emerald-200', Expired: 'bg-muted text-muted-foreground border-border', Cancelled: 'bg-muted text-muted-foreground border-border',
};
const errText = (e) => e?.response?.data?.error || e?.message || 'Something went wrong';

export default function ConversationPanel({ kycCase, client, currentUser }) {
  const [rows, setRows] = useState(null);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [days, setDays] = useState('');
  const [sendEmail, setSendEmail] = useState(true);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(null);
  const canWork = hasPermission(currentUser?.app_role, 'outreachConversationWork');

  const load = useCallback(async () => {
    try {
      setRows(list(await base44.entities.OutreachConversation.filter({ case_id: kycCase.id }, '-created_date', 20)));
    } catch { setRows([]); }
  }, [kycCase?.id]);
  useEffect(() => { load(); }, [load]);

  function start() {
    setName(client?.primary_contact_name || client?.full_name || '');
    setEmail(client?.primary_contact_email || '');
    setDays('');
    setSendEmail(true);
    setSent(null);
    setOpen(true);
  }

  async function send() {
    setBusy(true);
    try {
      const r = await base44.functions.invoke('sendOutreachConversation', {
        case_id: kycCase.id, invited_name: name.trim(), invited_email: email.trim(), deadline_days: days ? Number(days) : undefined,
        send_email: sendEmail, portal_origin: window.location.origin,
      });
      if (r?.data?.error) throw new Error(r.data.error);
      setSent(r.data);
      toast({ title: r.data.emailed ? 'Guided conversation sent' : 'Guided conversation created', description: r.data.email_error ? `The email could not be sent: ${r.data.email_error}` : undefined, variant: r.data.email_error ? 'destructive' : undefined });
      load();
    } catch (e) {
      toast({ variant: 'destructive', title: 'Not sent', description: errText(e) });
    } finally { setBusy(false); }
  }

  return (
    <section className="mb-5 rounded-xl border border-border bg-card p-4">
      <div className="flex flex-wrap items-center gap-2">
        <MessagesSquare className="h-4 w-4 text-primary" />
        <div className="text-sm font-semibold">Guided conversation</div>
        <span className="text-xs text-muted-foreground">A conversation-style outreach built from the blocks and templates in Tenant Config. The classic outreach below stays available.</span>
        {canWork && <Button size="sm" className="ml-auto gap-1.5" onClick={start}><Send className="h-3.5 w-3.5" /> Start guided conversation</Button>}
      </div>
      {rows === null ? <Loader2 className="mt-3 h-4 w-4 animate-spin text-muted-foreground" /> : rows.length === 0 ? (
        <p className="mt-2 text-xs text-muted-foreground">No guided conversation for this case yet.</p>
      ) : (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-xs">
            <thead><tr className="border-b border-border text-left text-muted-foreground">
              <th className="py-1.5 pr-3 font-medium">Template</th><th className="py-1.5 pr-3 font-medium">Invited</th><th className="py-1.5 pr-3 font-medium">Status</th>
              <th className="py-1.5 pr-3 font-medium">Sent</th><th className="py-1.5 pr-3 font-medium">First opened</th><th className="py-1.5 pr-3 font-medium">Deadline</th><th className="py-1.5 font-medium">Progress</th>
            </tr></thead>
            <tbody>
              {rows.map((c) => (
                <tr key={c.id} className="border-b border-border/60">
                  <td className="py-1.5 pr-3">{c.template_snapshot?.name || c.template_key} <span className="text-muted-foreground">v{c.template_version}</span>{c.kvk_environment === 'test' && <Badge variant="outline" className="ml-1 text-[10px]">KvK test data</Badge>}</td>
                  <td className="py-1.5 pr-3">{c.invited_name}<span className="block text-muted-foreground">{c.invited_email}</span></td>
                  <td className="py-1.5 pr-3"><span className={`rounded-full border px-2 py-0.5 text-[11px] ${STATUS_TONE[c.status] || STATUS_TONE.Sent}`}>{String(c.status || 'Sent').replace(/_/g, ' ')}</span></td>
                  <td className="py-1.5 pr-3">{fmt(c.sent_at)}<span className="block text-muted-foreground">{c.sent_by}</span></td>
                  <td className="py-1.5 pr-3">{fmt(c.first_opened_at)}</td>
                  <td className="py-1.5 pr-3">{fmt(c.deadline)}</td>
                  <td className="py-1.5">{c.progress_steps || 0} / {c.progress_total || 0}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Dialog open={open} onOpenChange={(v) => !busy && setOpen(v)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Start guided conversation</DialogTitle>
            <DialogDescription>The published template for a {client?.client_type === 'ORG' ? 'organisation' : 'person'} and this case type is used, with the case's risk class. Later template changes do not affect this request.</DialogDescription>
          </DialogHeader>
          {!sent ? (
            <div className="space-y-3">
              <label className="block space-y-1 text-xs font-medium">Invite (name)<Input value={name} onChange={(e) => setName(e.target.value)} /></label>
              <label className="block space-y-1 text-xs font-medium">Email address<Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></label>
              <label className="block space-y-1 text-xs font-medium">Deadline in days (empty = template default)<Input type="number" min={1} max={365} value={days} onChange={(e) => setDays(e.target.value)} /></label>
              <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={sendEmail} onChange={(e) => setSendEmail(e.target.checked)} /> Send the invitation email now</label>
              <div className="flex justify-end gap-2">
                <Button variant="outline" disabled={busy} onClick={() => setOpen(false)}>Cancel</Button>
                <Button className="gap-1.5" disabled={busy || !email.trim()} onClick={send}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} Send</Button>
              </div>
            </div>
          ) : (
            <div className="space-y-3 text-sm">
              <p>{sent.emailed ? 'The invitation was emailed.' : 'The request is ready.'} Template: <b>{sent.template?.name}</b> v{sent.template?.version}. Deadline {fmt(sent.deadline)}.</p>
              <div className="space-y-1">
                <div className="text-xs font-medium">Client link (shown once; it is not stored)</div>
                <div className="flex gap-2">
                  <Input readOnly value={sent.link} className="font-mono text-xs" onFocus={(e) => e.target.select()} />
                  <Button variant="outline" size="icon" aria-label="Copy link" onClick={async () => { try { await navigator.clipboard.writeText(sent.link); toast({ title: 'Link copied' }); } catch { /* clipboard blocked */ } }}><Copy className="h-4 w-4" /></Button>
                </div>
              </div>
              <div className="flex justify-end"><Button onClick={() => setOpen(false)}>Done</Button></div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </section>
  );
}
