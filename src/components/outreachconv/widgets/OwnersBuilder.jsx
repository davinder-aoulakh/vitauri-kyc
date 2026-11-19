import React, { useState } from 'react';
import { OC } from '@/lib/outreachConvStrings';

/** Owners or partners: rows of type (person | company), name and share; running total; error above 100 %. */
export default function OwnersBuilder({ step, busy, onAnswer }) {
  const [rows, setRows] = useState(() => (step.rows?.length ? [...step.rows.map((r) => ({ type: r.type || 'company', name: r.name || '', pct: r.pct ?? '' })), { type: 'person', name: '', pct: '' }] : [{ type: 'person', name: '', pct: '' }]));
  const set = (i, patch) => setRows((r) => r.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const filled = rows.filter((r) => r.name.trim());
  const total = filled.reduce((t, r) => t + (Number(r.pct) || 0), 0);
  const badPct = filled.some((r) => !(Number(r.pct) > 0 && Number(r.pct) <= 100));
  const over = total > 100.0001;
  const partners = step.mode === 'partners';
  return (
    <div className="oc-widget oc-wide">
      <div className="oc-owners">
        {rows.map((r, i) => (
          <div key={i} className="oc-owner">
            {!partners && (
              <select className="oc-in oc-narrow" value={r.type} onChange={(e) => set(i, { type: e.target.value })} disabled={busy} aria-label={OC.ownerType}>
                <option value="person">{OC.person}</option><option value="company">{OC.company}</option>
              </select>
            )}
            <input className="oc-in" placeholder={r.type === 'company' ? OC.companyName : OC.personName} value={r.name} onChange={(e) => set(i, { name: e.target.value })} disabled={busy} aria-label={OC.personName} />
            <input className="oc-in oc-pct" inputMode="decimal" placeholder="%" value={r.pct} onChange={(e) => set(i, { pct: e.target.value.replace(',', '.') })} disabled={busy} aria-label={OC.share} />
            {rows.length > 1 && <button type="button" className="oc-link" aria-label={OC.remove} onClick={() => setRows((x) => x.filter((_, j) => j !== i))} disabled={busy}>×</button>}
          </div>
        ))}
      </div>
      <button type="button" className="oc-link" disabled={busy} onClick={() => setRows((r) => [...r, { type: 'person', name: '', pct: '' }])}>+ {partners ? OC.addPartner : OC.addOwner}</button>
      <p className={`oc-small${over ? ' oc-err' : ''}`} style={{ padding: 0 }} role="status">
        {OC.total}: {Math.round(total * 10) / 10}%{over ? ` — ${step.over_note || ''}` : total < 99.95 && filled.length && !partners ? ` — ${step.rest_note || ''}` : ''}
      </p>
      <button type="button" className="oc-btn" disabled={busy || !filled.length || badPct || over} onClick={() => onAnswer(filled.map((r) => ({ type: partners ? 'person' : r.type, name: r.name.trim(), pct: Number(r.pct) })))}>{OC.continue}</button>
    </div>
  );
}
