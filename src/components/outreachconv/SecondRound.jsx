// Guided conversation, phase 9 (spec 5.7): open requests from a colleague (upload or text answer, "later" for documents)
// and, after submission, the composer under the thread. Talks to the page's handlers only (outreachPortal / outreachUpload).
import React, { useState } from 'react';
import { OC } from '@/lib/outreachConvStrings';
import Upload from '@/components/outreachconv/widgets/Upload';

function TextAnswer({ request, busy, onMessage }) {
  const [text, setText] = useState('');
  return (
    <form className="oc-form" onSubmit={async (e) => { e.preventDefault(); if (text.trim() && await onMessage(text, request.id)) setText(''); }}>
      <label className="oc-lbl" htmlFor={`req-${request.id}`}>{request.title}</label>
      <textarea id={`req-${request.id}`} className="oc-in" rows={3} maxLength={2000} value={text} onChange={(e) => setText(e.target.value)} disabled={busy} />
      <div className="oc-row"><button type="submit" className="oc-btn" disabled={busy || !text.trim()}>{OC.send}</button></div>
    </form>
  );
}

export function OpenRequestCards({ v, busy, onMessage, onRequestUpload, onDefer, onReload }) {
  const open = (v.open_requests || []).filter((r) => r.status === 'open' && (r.kind === 'analyst_request' || v.submitted));
  if (!open.length) return null;
  return (
    <div className="oc-widget oc-requests" aria-label={OC.openRequests}>
      {open.map((r) => (
        <div key={r.id} className="oc-request">
          {r.request_type === 'document' ? (
            <Upload
              step={{ id: `request:${r.id}`, text: r.title, checks: [], allow_defer: !r.deferred }}
              busy={busy}
              onUpload={(_stepId, file) => onRequestUpload(r.id, file)}
              onAnswer={async (value) => { if (value?.deferred) await onDefer(r.id); else await onReload(); }}
            />
          ) : (
            <TextAnswer request={r} busy={busy} onMessage={onMessage} />
          )}
        </div>
      ))}
    </div>
  );
}

export function Composer({ busy, onMessage }) {
  const [text, setText] = useState('');
  return (
    <form className="oc-composer" onSubmit={async (e) => { e.preventDefault(); if (text.trim() && await onMessage(text, null)) setText(''); }}>
      <label className="sr-only" htmlFor="oc-composer">{OC.composerPlaceholder}</label>
      <textarea id="oc-composer" className="oc-in" rows={2} maxLength={2000} placeholder={OC.composerPlaceholder} value={text} onChange={(e) => setText(e.target.value)} disabled={busy}
        onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); e.currentTarget.form?.requestSubmit(); } }} />
      <button type="submit" className="oc-btn" disabled={busy || !text.trim()}>{OC.send}</button>
    </form>
  );
}
