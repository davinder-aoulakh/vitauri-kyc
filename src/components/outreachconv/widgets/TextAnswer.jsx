import React, { useState } from 'react';
import { OC } from '@/lib/outreachConvStrings';
/** Free text (text: Enter sends) or a longer answer (area). */
export default function TextAnswer({ step, busy, onAnswer }) {
  const [v, setV] = useState('');
  const send = () => { if (v.trim()) onAnswer(v.trim()); };
  return (
    <form className="oc-form" onSubmit={(e) => { e.preventDefault(); send(); }}>
      {step.widget === 'area'
        ? <textarea className="oc-in" rows={3} value={v} onChange={(e) => setV(e.target.value)} aria-label={step.text} disabled={busy} />
        : <input className="oc-in" value={v} onChange={(e) => setV(e.target.value)} aria-label={step.text} disabled={busy} autoComplete="off" />}
      <button type="submit" className="oc-btn" disabled={busy || !v.trim()}>{OC.send}</button>
    </form>
  );
}
