// Guided conversation outreach, staff side: AI follow-ups waiting for approval (spec 6.2) and the documents clients uploaded
// in the case's conversations, with their check results. Writes go through manageOutreachConversation only.
import React, { useCallback, useEffect, useState } from 'react';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { toast } from '@/components/ui/use-toast';
import { CheckCircle2, FileText, Loader2, Sparkles } from 'lucide-react';
import SecondRoundPanel from './SecondRoundPanel';

const errText = (e) => e?.response?.data?.error || e?.message || 'Something went wrong';
const EV_TONE = { passed: 'border-emerald-300 text-emerald-800', failed: 'border-red-300 text-red-800', pending: 'border-amber-300 text-amber-800', deferred: 'border-slate-300 text-slate-700' };
const EV_LABEL = { passed: 'Checks met', failed: 'Check not met', pending: 'Pending review', deferred: 'Deferred' };

function Pending({ p, onDone }) {
  const [text, setText] = useState(p.proposal || p.default_text);
  const [busy, setBusy] = useState(false);
  async function approve(extra) {
    setBusy(true);
    try {
      await base44.functions.invoke('manageOutreachConversation', { action: 'approve', conversation_id: p.conversation_id, ...extra });
      toast({ title: 'Follow-up question sent' });
      onDone();
    } catch (e) { toast({ title: 'Not sent', description: errText(e), variant: 'destructive' }); } finally { setBusy(false); }
  }
  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50/60 p-3 text-xs">
      <div className="font-semibold">{p.invited_name} is waiting: {p.block_label}</div>
      <div className="mt-1 text-muted-foreground">Client's answer: <span className="text-foreground">{p.client_answer || '—'}</span></div>
      <label className="mt-2 block font-medium">Question to send {p.proposal_ai && <Badge variant="outline" className="ml-1 gap-1 text-[10px]"><Sparkles className="h-3 w-3" /> AI-assisted</Badge>}</label>
      <textarea className="mt-1 w-full rounded-md border border-border bg-background p-2 text-xs" rows={2} value={text} onChange={(e) => setText(e.target.value)} disabled={busy} />
      <div className="mt-1 text-muted-foreground">Default text: {p.default_text}</div>
      <div className="mt-2 flex flex-wrap gap-2">
        <Button size="sm" disabled={busy || !text.trim()} onClick={() => approve(text.trim() !== (p.proposal || p.default_text) ? { text: text.trim() } : {})}>{busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />} {text.trim() !== (p.proposal || p.default_text) ? 'Edit and approve' : 'Approve'}</Button>
        <Button size="sm" variant="outline" disabled={busy} onClick={() => approve({ use_default: true })}>Use the default text</Button>
      </div>
    </div>
  );
}

export default function ApprovalsAndEvidence({ kycCase, canWork, reloadKey }) {
  const [data, setData] = useState(null);
  const load = useCallback(async () => {
    if (!canWork || !kycCase?.id) return;
    try {
      const r = await base44.functions.invoke('manageOutreachConversation', { action: 'list_pending', case_id: kycCase.id });
      setData(r.data);
    } catch { setData({ pending: [], evidence: [] }); }
  }, [canWork, kycCase?.id]);
  useEffect(() => { load(); }, [load, reloadKey]);
  useEffect(() => { if (!data?.pending?.length) return undefined; const t = setInterval(load, 15000); return () => clearInterval(t); }, [data?.pending?.length, load]);

  async function openFile(id) {
    try {
      const r = await base44.functions.invoke('manageOutreachConversation', { action: 'evidence_url', evidence_id: id });
      if (r.data?.url) window.open(r.data.url, '_blank', 'noopener');
    } catch (e) { toast({ title: 'Could not open the file', description: errText(e), variant: 'destructive' }); }
  }

  if (!canWork || !data) return null;
  const { pending = [], evidence = [], invites = [] } = data;
  if (!pending.length && !evidence.length && !invites.length && !data.conversations?.length) return null;
  const queuedConvs = [...new Set(invites.filter((i) => i.status === 'Queued').map((i) => i.conversation_id))];
  async function release(conversationId) {
    try {
      const r = await base44.functions.invoke('manageOutreachConversation', { action: 'release_invites', conversation_id: conversationId, portal_origin: window.location.origin });
      toast({ title: r.data?.released?.length ? `Invitations sent: ${r.data.released.join(', ')}` : 'Nothing to release' });
      load();
    } catch (e) { toast({ title: 'Not released', description: errText(e), variant: 'destructive' }); }
  }
  return (
    <div className="mt-3 space-y-3">
      <SecondRoundPanel data={data} onReload={load} onOpenFile={openFile} />
      {pending.length > 0 && (
        <div className="space-y-2">
          <div className="text-xs font-semibold">Waiting for your approval ({pending.length})</div>
          {pending.map((p) => <Pending key={`${p.conversation_id}:${p.block_key}`} p={p} onDone={load} />)}
        </div>
      )}
      {invites.length > 0 && (
        <div>
          <div className="flex items-center gap-2 text-xs font-semibold">Invitations for own checks
            {queuedConvs.map((cid) => <Button key={cid} size="sm" variant="outline" className="ml-auto h-6 text-xs" onClick={() => release(cid)} title="Queued invitations go out when the representative passes the ID check. Staff can send them earlier here (audited as a manual release).">Release queued invitations</Button>)}
          </div>
          <ul className="mt-1 divide-y divide-border rounded-lg border border-border text-xs">
            {invites.map((i) => (
              <li key={i.id} className="flex flex-wrap items-center gap-2 p-2">
                <span className="font-medium">{i.name}</span><span className="text-muted-foreground">{i.roles}</span><span className="text-muted-foreground">{i.email}</span>
                <Badge variant="outline" className="ml-auto text-[10px]">{i.status}</Badge>
              </li>
            ))}
          </ul>
        </div>
      )}
      {evidence.length > 0 && (
        <div>
          <div className="text-xs font-semibold">Documents from the conversation</div>
          <ul className="mt-1 divide-y divide-border rounded-lg border border-border text-xs">
            {evidence.map((e) => (
              <li key={e.id} className="flex flex-wrap items-start gap-2 p-2">
                <FileText className="mt-0.5 h-3.5 w-3.5 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <div className="font-medium">{e.name} <span className="text-muted-foreground">({e.block_key})</span></div>
                  <ul className="mt-0.5 text-muted-foreground">
                    {(e.checks || []).map((c) => <li key={c.name}>{c.ok === true ? '✓' : c.ok === false ? '✗' : '…'} {c.name}{c.message ? ` — ${c.message}` : ''}</li>)}
                  </ul>
                </div>
                <Badge variant="outline" className={`text-[10px] ${EV_TONE[e.status] || ''}`}>{EV_LABEL[e.status] || e.status}</Badge>
                <Button size="sm" variant="ghost" className="h-6 text-xs" onClick={() => openFile(e.id)}>Open file</Button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
