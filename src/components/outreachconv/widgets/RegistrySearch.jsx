import React, { useEffect, useRef, useState } from 'react';
import { OC } from '@/lib/outreachConvStrings';

/**
 * Company registry search. KvK (Netherlands): typeahead from 2 characters. Didit (other countries): a Search button with a
 * limited number of searches (each search may be billed). Picking a result loads the register data on the server; then the
 * conversation continues with "Is this your organisation?". "I cannot find my organisation" falls back (Didit, then documents).
 */
export default function RegistrySearch({ step, busy, onAnswer, onRegistry }) {
  const kvk = step.provider === 'kvk';
  const [q, setQ] = useState('');
  const [list, setList] = useState(null);
  const [left, setLeft] = useState(step.searches_left ?? null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');
  const timer = useRef(null);

  async function search(text) {
    setLoading(true); setErr('');
    const r = await onRegistry('search', { q: text });
    setLoading(false);
    if (!r) return;
    if (r.fallback) { onAnswer({ not_found: true, reason: 'registry unavailable' }); return; }
    if (r.limit_reached) { setLeft(0); setErr(OC.searchLimit); return; }
    if (r.error || r.ok === false) { setErr(r.error || r.message || OC.notSaved); return; }
    setList(r.candidates || []);
    if (r.searches_left != null) setLeft(r.searches_left);
  }
  useEffect(() => {
    if (!kvk) return undefined;
    clearTimeout(timer.current);
    if (q.trim().length < 2) { setList(null); return undefined; }
    timer.current = setTimeout(() => search(q.trim()), 350);
    return () => clearTimeout(timer.current);
  }, [q, kvk]); // eslint-disable-line react-hooks/exhaustive-deps

  async function pick(c) {
    setLoading(true); setErr('');
    const r = await onRegistry('select', { id: c.id });
    setLoading(false);
    if (!r) return;
    if (r.fallback) { onAnswer({ not_found: true, reason: 'registry unavailable' }); return; }
    if (!r.ok) { setErr(r.error || r.message || OC.notSaved); return; }
    onAnswer({ selected: true });
  }

  return (
    <div className="oc-widget oc-wide">
      <form className="oc-form oc-row" style={{ padding: 0, border: 0 }} onSubmit={(e) => { e.preventDefault(); if (!kvk && q.trim().length >= 2) search(q.trim()); }}>
        <input className="oc-in" value={q} onChange={(e) => setQ(e.target.value)} placeholder={kvk ? OC.typeToSearch : OC.nameOrNumber} aria-label={step.text} disabled={busy} autoComplete="organization" />
        {!kvk && <button type="submit" className="oc-btn" disabled={busy || loading || q.trim().length < 2 || left === 0}>{OC.search}</button>}
      </form>
      {!kvk && left != null && <p className="oc-small">{OC.searchesLeft(left)}</p>}
      {loading && <p className="oc-small oc-wait" role="status"><span className="oc-typing" aria-hidden="true"><span /><span /><span /></span> {OC.searching}</p>}
      {list && !loading && (
        list.length ? (
          <ul className="oc-people" aria-label={OC.results}>
            {list.map((c) => (
              <li key={c.id}>
                <button type="button" className="oc-link" style={{ textAlign: 'left', textDecoration: 'none' }} disabled={busy} onClick={() => pick(c)}>
                  <b>{c.name}</b> · {c.number}{c.city || c.address ? ` · ${c.city || c.address}` : ''}
                </button>
                {c.status && <span className="oc-src">{c.status}</span>}
              </li>
            ))}
          </ul>
        ) : <p className="oc-small">{OC.noResults}</p>
      )}
      {err && <p className="oc-err" style={{ padding: 0 }} role="alert">{err}</p>}
      <button type="button" className="oc-link" disabled={busy} onClick={() => onAnswer({ not_found: true })}>{step.cannot_find || OC.cannotFind}</button>
    </div>
  );
}
