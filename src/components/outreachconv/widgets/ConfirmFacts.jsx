import React from 'react';
/** Facts (key-value) plus chips, e.g. the identity data read from the ID, or the prefilled email address. */
export default function ConfirmFacts({ step, busy, onAnswer }) {
  return (
    <div className="oc-widget">
      {step.facts?.length > 0 && (
        <dl className="oc-facts">{step.facts.map((f) => <div key={f.label}><dt>{f.label}</dt><dd>{f.value}</dd></div>)}</dl>
      )}
      {step.prefill && !step.facts && <dl className="oc-facts"><div><dt>Email</dt><dd>{step.prefill}</dd></div></dl>}
      {step.note && <p className="oc-small">{step.note}</p>}
      <div className="oc-chips oc-chips-in">{step.options.map((o) => <button key={o} type="button" className="oc-chip" disabled={busy} onClick={() => onAnswer(o)}>{o}</button>)}</div>
    </div>
  );
}
