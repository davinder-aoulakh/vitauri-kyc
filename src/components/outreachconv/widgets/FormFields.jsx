import React, { useState } from 'react';
import { OC } from '@/lib/outreachConvStrings';
/** Small form with labelled fields, all required (used for corrections; fields come from the step). */
export default function FormFields({ step, busy, onAnswer }) {
  const fields = step.fields || [];
  const [v, setV] = useState(Object.fromEntries(fields.map((f) => [f.key, ''])));
  const ok = fields.every((f) => String(v[f.key] || '').trim());
  return (
    <form className="oc-form oc-grid2" onSubmit={(e) => { e.preventDefault(); if (ok) onAnswer(v); }}>
      {fields.map((f) => <label key={f.key} className="oc-lbl">{f.label}<input className="oc-in" value={v[f.key]} onChange={(e) => setV((x) => ({ ...x, [f.key]: e.target.value }))} disabled={busy} /></label>)}
      <div className="oc-span2"><button type="submit" className="oc-btn" disabled={busy || !ok}>{OC.continue}</button></div>
    </form>
  );
}
