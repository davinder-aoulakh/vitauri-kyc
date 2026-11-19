import React, { useState } from 'react';
import { OC } from '@/lib/outreachConvStrings';
/** Residential address: country, postcode, house number, street, city. All required. */
export default function Address({ countries, busy, onAnswer }) {
  const list = countries?.length ? countries : [];
  const [a, setA] = useState({ country: list[0] || '', postcode: '', number: '', street: '', city: '' });
  const set = (k) => (e) => setA((x) => ({ ...x, [k]: e.target.value }));
  const ok = ['country', 'postcode', 'number', 'street', 'city'].every((k) => String(a[k]).trim());
  return (
    <form className="oc-form oc-grid2" onSubmit={(e) => { e.preventDefault(); if (ok) onAnswer(a); }}>
      <label className="oc-lbl oc-span2">{OC.country}
        {list.length ? <select className="oc-in" value={a.country} onChange={set('country')} disabled={busy}>{list.map((c) => <option key={c}>{c}</option>)}</select>
          : <input className="oc-in" value={a.country} onChange={set('country')} disabled={busy} autoComplete="country-name" />}
      </label>
      <label className="oc-lbl">{OC.postcode}<input className="oc-in" value={a.postcode} onChange={set('postcode')} disabled={busy} autoComplete="postal-code" /></label>
      <label className="oc-lbl">{OC.houseNumber}<input className="oc-in" value={a.number} onChange={set('number')} disabled={busy} /></label>
      <label className="oc-lbl">{OC.street}<input className="oc-in" value={a.street} onChange={set('street')} disabled={busy} autoComplete="address-line1" /></label>
      <label className="oc-lbl">{OC.city}<input className="oc-in" value={a.city} onChange={set('city')} disabled={busy} autoComplete="address-level2" /></label>
      <div className="oc-span2"><button type="submit" className="oc-btn" disabled={busy || !ok}>{OC.continue}</button></div>
    </form>
  );
}
