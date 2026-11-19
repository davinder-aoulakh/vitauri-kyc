import React, { useEffect, useRef, useState } from 'react';
import { OC } from '@/lib/outreachConvStrings';
/** Declaration: terms checkbox, typed full name (the server checks it against the ID name) and a signature canvas (touch and mouse). */
export default function Sign({ step, busy, onAnswer }) {
  const canvas = useRef(null);
  const drawing = useRef(false);
  const [terms, setTerms] = useState(false);
  const [name, setName] = useState('');
  const [signed, setSigned] = useState(false);
  useEffect(() => {
    const c = canvas.current;
    if (!c) return;
    const ratio = window.devicePixelRatio || 1;
    c.width = c.offsetWidth * ratio; c.height = c.offsetHeight * ratio;
    const ctx = c.getContext('2d'); ctx.scale(ratio, ratio); ctx.lineWidth = 2; ctx.lineCap = 'round'; ctx.strokeStyle = getComputedStyle(c).color || '#12342b';
  }, []);
  const pos = (e) => { const r = canvas.current.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
  const down = (e) => { drawing.current = true; canvas.current.setPointerCapture?.(e.pointerId); const ctx = canvas.current.getContext('2d'); ctx.beginPath(); ctx.moveTo(...pos(e)); };
  const move = (e) => { if (!drawing.current) return; const ctx = canvas.current.getContext('2d'); ctx.lineTo(...pos(e)); ctx.stroke(); setSigned(true); };
  const up = () => { drawing.current = false; };
  const clear = () => { const c = canvas.current; c.getContext('2d').clearRect(0, 0, c.width, c.height); setSigned(false); };
  const ready = terms && name.trim() && signed;
  return (
    <div className="oc-widget oc-wide">
      {step.declaration && <p className="oc-decl">{step.declaration}</p>}
      <label className="oc-check"><input type="checkbox" checked={terms} onChange={(e) => setTerms(e.target.checked)} disabled={busy} /> {OC.terms}</label>
      <label className="oc-lbl">{OC.typeName}<input className="oc-in" value={name} onChange={(e) => setName(e.target.value)} disabled={busy} autoComplete="name" /></label>
      <div className="oc-lbl">{OC.signHere}</div>
      <canvas ref={canvas} className="oc-sig" aria-label={OC.signHere} role="img" onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerLeave={up} />
      <div className="oc-row">
        <button type="button" className="oc-link" onClick={clear} disabled={busy}>{OC.clear}</button>
        <button type="button" className="oc-btn" disabled={busy || !ready} onClick={() => onAnswer({ terms, typed_name: name.trim(), signature: canvas.current.toDataURL('image/png') })}>{OC.confirmSubmit}</button>
      </div>
    </div>
  );
}
