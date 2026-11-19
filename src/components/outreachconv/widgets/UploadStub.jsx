import React, { useRef } from 'react';
import { OC } from '@/lib/outreachConvStrings';
/** Test stand-in for uploads (real storage and document checks arrive with phase 5): only the file name, size and type are sent. */
export default function UploadStub({ step, busy, onAnswer }) {
  const input = useRef(null);
  return (
    <div className="oc-widget oc-test">
      <p className="oc-small">{OC.uploadTest}</p>
      <input ref={input} type="file" accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png" className="oc-file" aria-label={step.text} disabled={busy}
        onChange={(e) => { const f = e.target.files?.[0]; if (f) onAnswer({ name: f.name, size: f.size, mime: f.type }); e.target.value = ''; }} />
      {step.checks?.length > 0 && <ul className="oc-checks">{step.checks.map((c) => <li key={c}>{c}</li>)}</ul>}
      {step.allow_defer && <button type="button" className="oc-chip" disabled={busy} onClick={() => onAnswer({ deferred: true })}>{OC.later}</button>}
    </div>
  );
}
