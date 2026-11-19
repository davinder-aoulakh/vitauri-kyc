import React, { useState } from 'react';
import { OC } from '@/lib/outreachConvStrings';

/**
 * People list: directors (proposal rows with a checkbox, name, role, authority, source) or authorised representatives
 * (name, authority choice, role or limit). "Add person"; at least one person must remain.
 */
export default function PeopleList({ step, busy, onAnswer }) {
  const reps = step.mode === 'reps';
  const [rows, setRows] = useState(() => (step.people || []).map((p) => ({ ...p, on: true })));
  const [adding, setAdding] = useState(reps && !(step.people || []).length);
  const [draft, setDraft] = useState({ name: '', role: step.default_role || '', authority: (step.authority_options || [])[0] || '', note: '' });
  const set = (i, patch) => setRows((r) => r.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const add = () => { if (!draft.name.trim()) return; setRows((r) => [...r, { ...draft, name: draft.name.trim(), source: 'rep', on: true }]); setDraft({ ...draft, name: '', note: '' }); setAdding(false); };
  const chosen = rows.filter((r) => r.on && r.name.trim());
  return (
    <div className="oc-widget oc-wide">
      <ul className="oc-people">
        {rows.map((r, i) => (
          <li key={`${r.name}-${i}`} className={r.on ? '' : 'off'}>
            <label className="oc-check">
              <input type="checkbox" checked={r.on} disabled={busy} onChange={(e) => set(i, { on: e.target.checked })} />
              <span><b>{r.name}</b>{r.role ? ` · ${r.role}` : ''}{r.authority ? ` · ${r.authority}` : ''}{r.note ? ` · ${r.note}` : ''}</span>
            </label>
            {r.source && r.source !== 'rep' && <span className="oc-src">{r.source === 'prop' ? OC.srcRegistry : OC.srcDocument}</span>}
          </li>
        ))}
      </ul>
      {adding ? (
        <div className="oc-form oc-grid2" style={{ padding: 0, border: 0 }}>
          <label className="oc-lbl">{OC.personName}<input className="oc-in" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} disabled={busy} /></label>
          {reps ? (
            <label className="oc-lbl">{OC.authority}
              <select className="oc-in" value={draft.authority} onChange={(e) => setDraft({ ...draft, authority: e.target.value })} disabled={busy}>{(step.authority_options || []).map((o) => <option key={o}>{o}</option>)}</select>
            </label>
          ) : (
            <label className="oc-lbl">{OC.role}<input className="oc-in" value={draft.role} onChange={(e) => setDraft({ ...draft, role: e.target.value })} disabled={busy} /></label>
          )}
          {reps && step.note_field && <label className="oc-lbl oc-span2">{OC.roleOrLimit}<input className="oc-in" value={draft.note} onChange={(e) => setDraft({ ...draft, note: e.target.value })} disabled={busy} /></label>}
          <div className="oc-span2 oc-row"><button type="button" className="oc-btn" disabled={busy || !draft.name.trim()} onClick={add}>{OC.addThisPerson}</button>{rows.length > 0 && <button type="button" className="oc-link" onClick={() => setAdding(false)}>{OC.cancel}</button>}</div>
        </div>
      ) : (
        <button type="button" className="oc-link" disabled={busy} onClick={() => setAdding(true)}>+ {OC.addPerson}</button>
      )}
      {!chosen.length && <p className="oc-small">{OC.keepOne}</p>}
      <button type="button" className="oc-btn" disabled={busy || !chosen.length || adding} onClick={() => onAnswer(chosen.map((p) => ({ name: p.name, role: p.role, authority: p.authority, note: p.note, source: p.source })))}>{OC.continue}</button>
    </div>
  );
}
