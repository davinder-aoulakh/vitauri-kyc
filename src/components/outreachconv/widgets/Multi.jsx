import React, { useState } from 'react';
import { OC } from '@/lib/outreachConvStrings';
/** Multiple choice: toggle chips; the "none" option clears the others; Continue needs at least one. */
export default function Multi({ step, busy, onAnswer }) {
  const [sel, setSel] = useState([]);
  const toggle = (o) => setSel((s) => {
    if (s.includes(o)) return s.filter((x) => x !== o);
    if (o === step.none_option) return [o];
    return [...s.filter((x) => x !== step.none_option), o];
  });
  return (
    <div className="oc-chips" role="group" aria-label={step.text}>
      {step.options.map((o) => <button key={o} type="button" className={`oc-chip${sel.includes(o) ? ' on' : ''}`} aria-pressed={sel.includes(o)} disabled={busy} onClick={() => toggle(o)}>{o}</button>)}
      <button type="button" className="oc-btn" disabled={busy || !sel.length} onClick={() => onAnswer(sel)}>{OC.continue}</button>
    </div>
  );
}
