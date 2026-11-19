// Public page of the guided conversation outreach: /o/:token. No sign-in. Talks to the backend function outreachPortal only,
// never to entities. The server decides what is asked; this page renders the rail, the thread and the widget of the current step.
// No external fonts, scripts or images (the tenant logo is the tenant's own URL).
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import { OC } from '@/lib/outreachConvStrings';
import '@/lib/outreachConvTokens.css';
import Widget from '@/components/outreachconv/widgets';
import StructureCard from '@/components/outreachconv/widgets/StructureCard';

const fmtDate = (iso) => { try { return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }); } catch { return ''; } };
const fmtTime = (iso) => { try { return new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }); } catch { return ''; } };
const errOf = (e) => ({ status: e?.response?.status || e?.status || 0, message: e?.response?.data?.error || e?.data?.error || e?.message || '' });
const initial = (name) => String(name || '').trim().charAt(0).toUpperCase() || '·';

function Shell({ tenant, children }) {
  const style = tenant?.brand_color ? { '--brand': tenant.brand_color } : undefined;
  return (
    <div className="oc" style={style}>
      <header className="oc-top">
        {tenant?.logo_url ? <img src={tenant.logo_url} alt="" /> : <span className="oc-mark" aria-hidden="true">{initial(tenant?.name)}</span>}
        <span>{tenant?.name || ''}</span>
      </header>
      {children}
    </div>
  );
}

function Centered({ tenant, title, body, children }) {
  return (
    <Shell tenant={tenant}>
      <main className="oc-center oc-card">
        <h1>{title}</h1>
        {body && <p>{body}</p>}
        {children}
        {tenant?.help_text && <p className="oc-small">{OC.needHelp} {tenant.help_text}</p>}
      </main>
    </Shell>
  );
}

function Rail({ v }) {
  const pct = v.progress?.pct || 0;
  return (
    <aside className="oc-side" aria-label={OC.progress}>
      <div className="oc-card oc-hello">
        <h1>{v.first_name ? `Hi ${v.first_name},` : 'Hello,'}</h1>
        {v.tenant?.welcome_text && <p>{String(v.tenant.welcome_text).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()}</p>}
      </div>
      {v.deadline && !v.submitted && (
        <div className="oc-card oc-deadline">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>
          <span>{OC.respondBy} <b>{fmtDate(v.deadline)}</b></span>
        </div>
      )}
      <div className="oc-card oc-progress">
        <div className="oc-prog-h"><span>{OC.progress}</span><span>{pct}%</span></div>
        <div className="oc-bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}><i style={{ width: `${pct}%` }} /></div>
        <ul className="oc-secs">
          {(v.sections || []).map((s) => (
            <li key={s.key} className={s.state}>
              <span className="oc-dot" aria-hidden="true">{s.state === 'done' ? '✓' : ''}</span>
              {s.label}{s.state === 'done' ? <span className="sr-only"> (done)</span> : s.state === 'current' ? <span className="sr-only"> (current)</span> : null}
            </li>
          ))}
        </ul>
        <div className="oc-small oc-eta" style={{ marginTop: 10 }}>{v.submitted ? OC.submittedEta : OC.minutesLeft(v.progress?.minutes_left ?? 0)}</div>
        <div className="oc-saved"><i aria-hidden="true" /><span>{v.saved_at && v.started ? OC.savedAt(fmtTime(v.saved_at)) : OC.saved}</span></div>
      </div>
      {(v.open_requests || []).length > 0 && (
        <div className="oc-card oc-req">
          <h3>{OC.openRequests}</h3>
          <ul className="oc-secs">{v.open_requests.map((r) => <li key={r.id}>{r.title}</li>)}</ul>
        </div>
      )}
      {v.tenant?.help_text && <div className="oc-small oc-help">{OC.needHelp} {v.tenant.help_text}</div>}
    </aside>
  );
}

function Message({ m, tenantName, onWhy }) {
  const [open, setOpen] = useState(false);
  if (m.kind === 'system_line') return <div className="oc-sys">{m.text}</div>;
  if (m.kind === 'idv_checks') {
    return (
      <ul className="oc-idv-checks oc-sys" aria-label={OC.idvChecks}>
        {(m.checks || []).map((c) => <li key={c.label} className={c.ok ? 'ok' : 'no'}><span aria-hidden="true">{c.ok ? '✓' : '✗'}</span>{c.label}<span className="sr-only">{c.ok ? ' (passed)' : ' (not passed)'}</span></li>)}
      </ul>
    );
  }
  if (m.kind === 'structure_card') return <StructureCard card={m.card} text={m.text} />;
  if (m.kind === 'status_card') {
    return (
      <div className="oc-status" role="status">
        <h3>{m.card?.title || ''}</h3>
        {m.card?.reference && <p>{OC.reference}: <b>{m.card.reference}</b></p>}
        <p>{m.text}</p>
      </div>
    );
  }
  const client = m.author_type === 'client';
  return (
    <div className={`oc-msg${client ? ' client' : ''}`}>
      {!client && <span className="oc-av" aria-hidden="true">{initial(m.author_type === 'analyst' ? m.author_name : tenantName)}</span>}
      <div>
        {(m.tag || m.ai_assisted) && <div className="oc-tag">{m.tag}{m.ai_assisted && <span className="oc-pill">AI-assisted</span>}</div>}
        <div className="oc-bubble">{m.text}</div>
        {!client && m.why && (
          <div className="oc-why">
            <button type="button" className="oc-link" aria-expanded={open} onClick={() => { if (!open && m.block_key) onWhy(m.block_key); setOpen(!open); }}>{OC.whyAsk}</button>
            {open && <div className="oc-whytext">{m.why}</div>}
          </div>
        )}
      </div>
    </div>
  );
}

function Typing({ tenantName }) {
  return (
    <div className="oc-msg" aria-label={OC.typing}>
      <span className="oc-av" aria-hidden="true">{initial(tenantName)}</span>
      <div><div className="oc-bubble oc-typing" aria-hidden="true"><span /><span /><span /></div></div>
    </div>
  );
}

const reducedMotion = () => { try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; } };
/** Spec 5.1: 250 ms for a short message, else 380 ms + 7 ms per character (at most 800 ms extra); none with reduced motion. */
const typingDelay = (text) => (reducedMotion() ? 0 : String(text || '').length <= 40 ? 250 : 380 + Math.min(800, 7 * String(text || '').length));
const newAnswerId = () => { try { return crypto.randomUUID(); } catch { return `a${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`; } };

export default function OutreachConversation() {
  const { token } = useParams();
  const [v, setV] = useState(null);
  const [err, setErr] = useState(null);
  const [asked, setAsked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [shown, setShown] = useState(0); // number of thread messages revealed (new bank messages appear one by one)
  const [typing, setTyping] = useState(false);
  const [saveErr, setSaveErr] = useState(false);
  const [fieldErr, setFieldErr] = useState('');
  const pending = useRef(null); // the last request that did not reach the server, resent as is (same client_answer_id)
  const threadEnd = useRef(null);

  const call = useCallback((action, extra = {}) => base44.functions.invoke('outreachPortal', { token, action, ...extra }), [token]);

  const open = useCallback(async () => {
    setErr(null);
    try {
      const r = await call('open');
      if (r?.data?.error) throw Object.assign(new Error(r.data.error), { status: r.status });
      setV(r.data);
      setShown(r.data?.thread?.length || 0);
      setAsked(!!r.data?.new_link_requested);
    } catch (e) {
      setErr(errOf(e));
    }
  }, [call]);

  useEffect(() => { open(); }, [open]);
  useEffect(() => { threadEnd.current?.scrollIntoView?.({ block: 'end' }); }, [shown, typing]);
  useEffect(() => {
    const m = /** @type {HTMLMetaElement | null} */ (document.querySelector('meta[name="viewport"]'));
    if (m && !/viewport-fit/.test(m.content)) m.content = `${m.content}, viewport-fit=cover`;
  }, []);

  // Reveal new messages: client and system lines at once, bank messages after a typing indicator.
  useEffect(() => {
    const thread = v?.thread || [];
    if (shown >= thread.length) { setTyping(false); return undefined; }
    const next = thread[shown];
    if (next.author_type !== 'bank') { setShown(shown + 1); return undefined; }
    const ms = typingDelay(next.text);
    if (!ms) { setShown(shown + 1); return undefined; }
    setTyping(true);
    const t = setTimeout(() => { setTyping(false); setShown((n) => n + 1); }, ms);
    return () => clearTimeout(t);
  }, [v?.thread, shown]);

  const send = useCallback(async (req) => {
    setBusy(true);
    setFieldErr('');
    try {
      const r = await call(req.action, req.body);
      pending.current = null;
      setSaveErr(false);
      setV(r.data);
      return true;
    } catch (e) {
      const { status, message } = errOf(e);
      const data = e?.response?.data || e?.data;
      if (status === 409) { pending.current = null; setSaveErr(false); await open(); return false; }
      if (status === 422 || status === 400) {
        pending.current = null;
        if (data && data.thread) setV(data);
        setFieldErr(data?.error || message);
        return false;
      }
      pending.current = req; // network or server error: keep the request (same id) for the retry
      setSaveErr(true);
      return false;
    } finally { setBusy(false); }
  }, [call, open]);

  useEffect(() => {
    const retry = () => { if (pending.current) send(pending.current); };
    window.addEventListener('online', retry);
    return () => window.removeEventListener('online', retry);
  }, [send]);

  const onAnswer = (value) => send({ action: 'answer', body: { client_answer_id: newAnswerId(), step_id: v.step?.id, value } });
  const onEdit = (key, value) => send({ action: 'edit', body: { client_answer_id: newAnswerId(), datapoint_key: key, value } });
  const onStart = () => send({ action: 'start', body: {} });
  // The Didit ID step: start / reuse the session and pull the result (quiet calls do not block the page).
  const onIdv = useCallback(async (action, { quiet = false } = {}) => {
    try {
      const r = await call(action, action === 'idv_start' ? { portal_origin: window.location.origin } : {});
      setV(r.data);
      if (!quiet) setFieldErr('');
      return r.data;
    } catch (e) {
      const { status, message } = errOf(e);
      if (status === 409) { await open(); return null; }
      if (!quiet) setFieldErr(message || OC.notSaved);
      return null;
    }
  }, [call, open]);

  // Upload step: the file goes to outreachUpload; errors come back as a message for the widget.
  const onUpload = useCallback(async (stepId, file) => {
    try {
      const r = await base44.functions.invoke('outreachUpload', { token, step_id: stepId, file });
      return r.data;
    } catch (e) {
      const { status, message } = errOf(e);
      if (status === 409) { await open(); return null; }
      return { error: message || OC.notSaved };
    }
  }, [token, open]);

  // Registry step: search and select go to outreachRegistry; the answer then names the selection.
  const onRegistry = useCallback(async (action, extra) => {
    try {
      const r = await base44.functions.invoke('outreachRegistry', { token, step_id: v?.step?.id, action, ...extra });
      return r.data;
    } catch (e) {
      const { status, message } = errOf(e);
      if (status === 409) { await open(); return null; }
      return { ok: false, error: message || OC.notSaved };
    }
  }, [token, open, v?.step?.id]);

  // An AI follow-up waits for a colleague's approval: look again every 5 seconds.
  useEffect(() => {
    if (v?.step?.widget !== 'wait') return undefined;
    const t = setInterval(() => { call('open').then((r) => { if (r?.data && !r.data.error) setV(r.data); }).catch(() => {}); }, 5000);
    return () => clearInterval(t);
  }, [v?.step?.widget, v?.step?.id, call]);

  // Back from Didit on this device (?didit_done=1): clean the address and check the result straight away.
  const diditReturn = useRef(typeof window !== 'undefined' && /[?&]didit_done=1/.test(window.location.search));
  useEffect(() => {
    if (diditReturn.current) window.history.replaceState(null, '', window.location.pathname);
  }, []);
  useEffect(() => {
    if (diditReturn.current && v?.step?.widget === 'idv') { diditReturn.current = false; onIdv('idv_status'); }
  }, [v?.step?.widget, onIdv]);

  const onWhy = (blockKey) => { call('why_opened', { block_key: blockKey }).catch(() => {}); };

  async function askNewLink() {
    setBusy(true);
    try {
      await call('request_new_link');
      setAsked(true);
    } catch (e) {
      setErr(errOf(e));
    } finally { setBusy(false); }
  }

  if (err) {
    if (err.status === 404) return <Centered tenant={v?.tenant} title={OC.notFoundTitle} body={OC.notFoundBody} />;
    if (err.status === 429) return <Centered tenant={v?.tenant} title={OC.notFoundTitle} body={OC.tooMany} />;
    return <Centered tenant={v?.tenant} title={OC.error} body={err.message}><button type="button" className="oc-btn" onClick={open}>{OC.retry}</button></Centered>;
  }
  if (!v) return <Shell><main className="oc-center" aria-busy="true"><div className="oc-spin" aria-hidden="true" /><p>{OC.loading}</p></main></Shell>;
  if (v.state === 'expired') {
    return (
      <Centered tenant={v.tenant} title={OC.expiredTitle} body={asked ? OC.newLinkRequested : OC.expiredBody}>
        {!asked && <button type="button" className="oc-btn" disabled={busy} onClick={askNewLink}>{OC.askNewLink}</button>}
      </Centered>
    );
  }
  if (v.state === 'cancelled') return <Centered tenant={v.tenant} title={OC.cancelledTitle} body={OC.cancelledBody} />;

  const thread = v.thread || [];
  const revealed = shown >= thread.length && !typing;
  return (
    <Shell tenant={v.tenant}>
      <div className="oc-grid">
        <Rail v={v} />
        <section className="oc-card oc-chat" aria-label={OC.application(v.tenant?.name || '')}>
          <div className="oc-chat-h">
            <span className="oc-av" aria-hidden="true">{initial(v.tenant?.name)}</span>
            <div>{OC.application(v.tenant?.name || '')}<small>{OC.conversationSaved}</small></div>
          </div>
          <div className="oc-thread" aria-live="polite">
            {thread.slice(0, shown).map((m) => <Message key={m.id} m={m} tenantName={v.tenant?.name} onWhy={onWhy} />)}
            {typing && <Typing tenantName={v.tenant?.name} />}
            <div ref={threadEnd} />
          </div>
          {revealed && !v.started && !v.submitted && v.start_chip && (
            <div className="oc-chips">
              <button type="button" className="oc-chip" disabled={busy} onClick={onStart}>{v.start_chip}</button>
            </div>
          )}
          {revealed && v.step && !v.submitted && <Widget key={v.step.id} step={v.step} view={v} busy={busy} onAnswer={onAnswer} onEdit={onEdit} onIdv={onIdv} onUpload={onUpload} onRegistry={onRegistry} />}
          {fieldErr && <p className="oc-err" role="alert">{fieldErr}</p>}
          {saveErr && (
            <div className="oc-chips" role="alert">
              <span className="oc-err" style={{ padding: 0, alignSelf: 'center' }}>{OC.notSaved}</span>
              <button type="button" className="oc-btn" disabled={busy} onClick={() => pending.current && send(pending.current)}>{busy ? OC.saving : OC.retry}</button>
            </div>
          )}
        </section>
      </div>
    </Shell>
  );
}
