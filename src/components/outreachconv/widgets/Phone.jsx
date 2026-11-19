import React, { useState } from 'react';
import { OC } from '@/lib/outreachConvStrings';
/** Country code (from the tenant settings) and number. The server checks the length. */
export default function Phone({ codes, busy, onAnswer }) {
  const list = codes?.length ? codes : ['+31'];
  const [code, setCode] = useState(list[0]);
  const [num, setNum] = useState('');
  return (
    <form className="oc-form oc-row" onSubmit={(e) => { e.preventDefault(); if (num.trim()) onAnswer({ code, number: num.trim() }); }}>
      <select className="oc-in oc-narrow" value={code} onChange={(e) => setCode(e.target.value)} aria-label={OC.countryCode} disabled={busy}>{list.map((c) => <option key={c}>{c}</option>)}</select>
      <input className="oc-in" inputMode="tel" autoComplete="tel-national" value={num} onChange={(e) => setNum(e.target.value)} aria-label={OC.phoneNumber} disabled={busy} />
      <button type="submit" className="oc-btn" disabled={busy || !num.trim()}>{OC.send}</button>
    </form>
  );
}
