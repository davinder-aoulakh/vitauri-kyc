import React, { useState } from 'react';
import { OC } from '@/lib/outreachConvStrings';

function EditRow({ row, busy, onSave, onCancel }) {
  const e = row.edit || {};
  const [v, setV] = useState(e.type === 'multi' ? String(row.value).split(', ').filter((x) => (e.options || []).includes(x)) : row.value);
  if (e.type === 'chips') {
    return <div className="oc-chips oc-chips-in">{e.options.map((o) => <button key={o} type="button" className={`oc-chip${v === o ? ' on' : ''}`} disabled={busy} onClick={() => onSave(o)}>{o}</button>)}<button type="button" className="oc-link" onClick={onCancel}>{OC.cancel}</button></div>;
  }
  if (e.type === 'multi') {
    const toggle = (o) => setV((s) => (s.includes(o) ? s.filter((x) => x !== o) : o === e.none_option ? [o] : [...s.filter((x) => x !== e.none_option), o]));
    return <div className="oc-chips oc-chips-in">{e.options.map((o) => <button key={o} type="button" className={`oc-chip${v.includes(o) ? ' on' : ''}`} aria-pressed={v.includes(o)} disabled={busy} onClick={() => toggle(o)}>{o}</button>)}<button type="button" className="oc-btn" disabled={busy || !v.length} onClick={() => onSave(v)}>{OC.save}</button><button type="button" className="oc-link" onClick={onCancel}>{OC.cancel}</button></div>;
  }
  return <form className="oc-form oc-row" onSubmit={(ev) => { ev.preventDefault(); if (String(v).trim()) onSave(String(v).trim()); }}><input className="oc-in" value={v} onChange={(ev) => setV(ev.target.value)} disabled={busy} aria-label={row.label} /><button type="submit" className="oc-btn" disabled={busy}>{OC.save}</button><button type="button" className="oc-link" onClick={onCancel}>{OC.cancel}</button></form>;
}

/** Everything once more, grouped, with the source of each value; editable rows get "Change". */
export default function Review({ step, busy, onAnswer, onEdit }) {
  const [editing, setEditing] = useState(null);
  const groups = [];
  for (const r of step.rows || []) {
    let g = groups.find((x) => x.label === r.section_label);
    if (!g) groups.push((g = { label: r.section_label, rows: [] }));
    g.rows.push(r);
  }
  return (
    <div className="oc-widget oc-wide">
      {groups.map((g) => (
        <section key={g.label} className="oc-sum">
          <h4>{g.label}</h4>
          {g.rows.map((r) => (
            <div key={r.key} className="r">
              <div className="k">{r.label}</div>
              <div className="v">
                {editing === r.key ? <EditRow row={r} busy={busy} onCancel={() => setEditing(null)} onSave={async (v) => { const ok = await onEdit(r.key, v); if (ok) setEditing(null); }} /> : <>{r.value}<span className="oc-src">{r.source_label}</span></>}
              </div>
              {r.editable && editing !== r.key && <button type="button" className="oc-link" disabled={busy} onClick={() => setEditing(r.key)}>{OC.change}</button>}
            </div>
          ))}
        </section>
      ))}
      <button type="button" className="oc-btn" disabled={busy || !!editing} onClick={() => onAnswer('confirmed')}>{OC.reviewConfirm}</button>
    </div>
  );
}
