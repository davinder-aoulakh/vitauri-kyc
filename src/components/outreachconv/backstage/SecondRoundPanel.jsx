// Guided conversation outreach, staff side of the second round (spec 5.7): ask the client a question or for a document in
// the same thread, reply to client messages, and follow the open requests. Writes go through manageOutreachConversation.
import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { toast } from '@/components/ui/use-toast';
import { Loader2, MessageSquare, Send } from 'lucide-react';

const errText = (e) => e?.response?.data?.error || e?.message || 'Something went wrong';
const fmt = (iso) => { try { return new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }); } catch { return ''; } };

function AskForm({ conversation, onDone }) {
  const [type, setType] = useState('document');
  const [title, setTitle] = useState('');
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    try {
      const r = await base44.functions.invoke('manageOutreachConversation', { action: 'ask', conversation_id: conversation.id, request_type: type, title, text });
      toast({ title: 'Sent to the client', description: r.data?.emailed ? 'The client was emailed about the new message.' : `No email sent${r.data?.email_error ? `: ${r.data.email_error}` : ''}.` });
      setTitle(''); setText(''); onDone();
    } catch (err) { toast({ title: 'Not sent', description: errText(err), variant: 'destructive' }); } finally { setBusy(false); }
  }
  return (
    <form onSubmit={submit} className="space-y-2 rounded-lg border border-border p-3 text-xs">
      <div className="font-semibold">Ask {conversation.invited_name || 'the client'}</div>
      <div className="flex gap-3">
        <label className="flex items-center gap-1"><input type="radio" checked={type === 'document'} onChange={() => setType('document')} /> Request a document</label>
        <label className="flex items-center gap-1"><input type="radio" checked={type === 'question'} onChange={() => setType('question')} /> Ask a question</label>
      </div>
      <input className="w-full rounded-md border border-border bg-background p-2" placeholder={type === 'document' ? 'Title, e.g. Latest annual accounts' : 'Title, e.g. Source of the deposit'} value={title} maxLength={140} onChange={(e) => setTitle(e.target.value)} disabled={busy} />
      <textarea className="w-full rounded-md border border-border bg-background p-2" rows={3} maxLength={2000} placeholder="Message to the client (shown in the conversation under your name)" value={text} onChange={(e) => setText(e.target.value)} disabled={busy} />
      <div className="text-muted-foreground">The client sees this in the conversation and gets a short email without any case details.</div>
      <Button size="sm" type="submit" disabled={busy || !title.trim() || !text.trim()}>{busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />} Send</Button>
    </form>
  );
}

function Reply({ conversation, onDone }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    try {
      await base44.functions.invoke('manageOutreachConversation', { action: 'reply', conversation_id: conversation.id, text });
      toast({ title: 'Reply sent' }); setText(''); onDone();
    } catch (err) { toast({ title: 'Not sent', description: errText(err), variant: 'destructive' }); } finally { setBusy(false); }
  }
  return (
    <form onSubmit={submit} className="flex gap-2">
      <input className="flex-1 rounded-md border border-border bg-background p-2 text-xs" placeholder="Reply in the conversation" value={text} maxLength={2000} onChange={(e) => setText(e.target.value)} disabled={busy} />
      <Button size="sm" type="submit" disabled={busy || !text.trim()}>Reply</Button>
    </form>
  );
}

export default function SecondRoundPanel({ data, onReload, onOpenFile }) {
  const conversations = (data?.conversations || []).filter((c) => !['Cancelled', 'Expired'].includes(c.status));
  const [sel, setSel] = useState(null);
  if (!conversations.length) return null;
  const current = conversations.find((c) => c.id === sel) || conversations.find((c) => c.submitted) || conversations[0];
  const reqs = (data.open_requests || []).filter((r) => r.conversation_id === current.id);
  const msgs = (data.messages || []).filter((m) => m.conversation_id === current.id);
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 text-xs font-semibold"><MessageSquare className="h-3.5 w-3.5" /> Second round
        {conversations.length > 1 && (
          <select className="ml-auto rounded border border-border bg-background px-1 py-0.5 text-xs font-normal" value={current.id} onChange={(e) => setSel(e.target.value)}>
            {conversations.map((c) => <option key={c.id} value={c.id}>{c.invited_name || c.id} ({c.status})</option>)}
          </select>
        )}
      </div>
      {reqs.length > 0 && (
        <ul className="divide-y divide-border rounded-lg border border-border text-xs">
          {reqs.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center gap-2 p-2">
              <span className="font-medium">{r.title}</span>
              <span className="text-muted-foreground">{r.kind === 'deferred_evidence' ? 'Deferred by the client' : `${r.request_type === 'document' ? 'Document' : 'Question'} from ${r.from_name || 'a colleague'}`}</span>
              {r.answer_text && <span className="w-full text-muted-foreground">Answer: <span className="text-foreground">{r.answer_text}</span></span>}
              {r.answer_evidence_id && <Button size="sm" variant="ghost" className="h-6 text-xs" onClick={() => onOpenFile(r.answer_evidence_id)}>Open file</Button>}
              <Badge variant="outline" className={`ml-auto text-[10px] ${r.status === 'answered' ? 'border-emerald-300 text-emerald-800' : 'border-amber-300 text-amber-800'}`}>{r.status === 'answered' ? 'Answered' : 'Open'}</Badge>
            </li>
          ))}
        </ul>
      )}
      {msgs.length > 0 && (
        <ul className="space-y-1 rounded-lg border border-border p-2 text-xs">
          {msgs.map((m) => (
            <li key={m.id} className={m.author_type === 'client' ? '' : 'text-muted-foreground'}>
              <span className="font-medium">{m.author_type === 'client' ? 'Client' : (m.tag || m.author_name)}</span> · {fmt(m.at)}: {m.text}
            </li>
          ))}
        </ul>
      )}
      <AskForm conversation={current} onDone={onReload} />
      {current.submitted && <Reply conversation={current} onDone={onReload} />}
    </div>
  );
}
