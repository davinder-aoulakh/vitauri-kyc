import React from 'react';
/** Single choice: one tap answers. */
export default function Chips({ step, busy, onAnswer }) {
  return (
    <div className="oc-chips" role="group" aria-label={step.text}>
      {step.options.map((o) => <button key={o} type="button" className="oc-chip" disabled={busy} onClick={() => onAnswer(o)}>{o}</button>)}
    </div>
  );
}
