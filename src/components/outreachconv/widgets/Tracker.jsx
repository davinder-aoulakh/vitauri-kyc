import React, { useState } from 'react';
import { OC } from '@/lib/outreachConvStrings';

const TONE = { 'Your check comes last': 'rep', 'To invite': 'todo', Queued: 'queued', Invited: 'sent', Opened: 'sent', Completed: 'done' };

/** Tracker of the people who need their own check (spec 9.6): send an invitation per person; Continue when nobody is left "To invite". */
function Row({ p, busy, onInvite }) {
  const [email, setEmail] = useState(p.email || '');
  const [sending, setSending] = useState(false);
  const [err, setErr] = useState('');
  const todo = p.status === 'To invite';
  async function send() {
    setSending(true); setErr('');
    const r = await onInvite(p.key, email.trim());
    setSending(false);
    if (r?.error) setErr(r.error);
  }
  return (
    <li className="oc-track">
      <div>
        <b>{p.name}</b>
        <span className="oc-small"> · {(p.roles || []).join(', ')}</span>
        <span className={`oc-status-pill ${TONE[p.status] || ''}`}>{OC.inviteStatus[p.status] || p.status}</span>
      </div>
      {todo && (
        <div className="oc-row">
          <input className="oc-in" type="email" inputMode="email" placeholder={OC.emailOf(p.name)} value={email} onChange={(e) => setEmail(e.target.value)} disabled={busy || sending} aria-label={OC.emailOf(p.name)} />
          <button type="button" className="oc-btn" disabled={busy || sending || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())} onClick={send}>{sending ? OC.saving : OC.sendInvitation}</button>
        </div>
      )}
      {err && <p className="oc-err" style={{ padding: 0 }} role="alert">{err}</p>}
    </li>
  );
}

export default function Tracker({ step, busy, onAnswer, onInvite }) {
  const rows = step.parties || [];
  const left = rows.filter((p) => p.status === 'To invite').length;
  return (
    <div className="oc-widget oc-wide">
      <ul className="oc-people">{rows.map((p) => <Row key={p.key} p={p} busy={busy} onInvite={onInvite} />)}</ul>
      {step.note && <p className="oc-small">{step.note}</p>}
      <button type="button" className="oc-btn" disabled={busy || left > 0} onClick={() => onAnswer('sent')}>{left > 0 ? OC.inviteLeft(left) : OC.continue}</button>
    </div>
  );
}
