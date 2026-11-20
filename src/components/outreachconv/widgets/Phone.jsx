import React, { useState } from 'react';
import { OC } from '@/lib/outreachConvStrings';
import CountryPicker from './CountryPicker';
/** Country code (every country with its flag; the tenant's codes first) and number. The server checks the length. */
export default function Phone({ codes, busy, onAnswer }) {
  const list = codes?.length ? codes : ['+31'];
  const [code, setCode] = useState({ dial: list[0], iso2: '' });
  const [num, setNum] = useState('');
  return (
    <form className="oc-form oc-row" onSubmit={(e) => { e.preventDefault(); if (num.trim()) onAnswer({ code: code.dial, number: num.trim() }); }}>
      <div className="oc-narrow oc-phone-code">
        <CountryPicker id="oc-phone-code" mode="dial" value={code} common={list} disabled={busy} ariaLabel={OC.countryCode} onChange={setCode} />
      </div>
      <input className="oc-in" inputMode="tel" autoComplete="tel-national" value={num} onChange={(e) => setNum(e.target.value)} aria-label={OC.phoneNumber} disabled={busy} />
      <button type="submit" className="oc-btn" disabled={busy || !num.trim()}>{OC.send}</button>
    </form>
  );
}
