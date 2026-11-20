import React, { useEffect, useMemo, useRef, useState } from 'react';
import { COUNTRY_META, countryByName } from '@/lib/countries';
import Flag from '@/components/shared/Flag';
import { OC } from '@/lib/outreachConvStrings';

const fold = (s) => String(s || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase();

/**
 * Country of the address: every country with its flag (inline SVG, no external request), searchable by typing.
 * The tenant's common countries (settings.addressCountries) are listed first. The value is the country name, as before.
 */
export default function CountryPicker({ value, onChange, common = [], disabled, id }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);
  const box = useRef(null);
  const search = useRef(null);
  const listId = `${id || 'country'}-list`;

  const all = useMemo(() => {
    const top = common.map((name) => { const m = countryByName(name); return { name, iso2: m?.iso2 || '', common: true }; });
    const seen = new Set(top.map((c) => c.iso2 || fold(c.name)));
    const rest = COUNTRY_META.filter((c) => !seen.has(c.iso2)).map((c) => ({ name: c.name, iso2: c.iso2, common: false })).sort((a, b) => a.name.localeCompare(b.name));
    return [...top, ...rest];
  }, [common]);
  const list = useMemo(() => {
    const f = fold(q).trim();
    return f ? all.filter((c) => fold(c.name).includes(f) || c.iso2.toLowerCase() === f) : all;
  }, [all, q]);
  const selected = all.find((c) => c.name === value) || (value ? { name: value, iso2: countryByName(value)?.iso2 || '' } : null);

  useEffect(() => { if (open) { setActive(0); setTimeout(() => search.current?.focus(), 0); } }, [open]);
  useEffect(() => {
    if (!open) return undefined;
    const close = (e) => { if (box.current && !box.current.contains(e.target)) setOpen(false); };
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, [open]);

  const pick = (c) => { onChange(c.name); setOpen(false); setQ(''); };
  const onKey = (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((i) => Math.min(i + 1, list.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((i) => Math.max(i - 1, 0)); }
    else if (e.key === 'Enter') { e.preventDefault(); if (list[active]) pick(list[active]); }
    else if (e.key === 'Escape') { e.preventDefault(); setOpen(false); }
  };

  return (
    <div className="oc-cpick" ref={box}>
      <button type="button" id={id} className="oc-in oc-cpick-btn" aria-haspopup="listbox" aria-expanded={open} disabled={disabled} onClick={() => setOpen((o) => !o)}>
        {selected ? <><Flag iso2={selected.iso2} /> <span>{selected.name}</span></> : <span className="oc-small">{OC.chooseCountry}</span>}
        <span aria-hidden="true" className="oc-cpick-caret">▾</span>
      </button>
      {open && (
        <div className="oc-cpick-pop">
          <input ref={search} className="oc-in" type="search" placeholder={OC.searchCountry} aria-label={OC.searchCountry} value={q}
            onChange={(e) => { setQ(e.target.value); setActive(0); }} onKeyDown={onKey} aria-controls={listId} aria-activedescendant={list[active] ? `${listId}-${active}` : undefined} />
          <ul id={listId} role="listbox" className="oc-cpick-list">
            {list.length === 0 && <li className="oc-small" role="option" aria-selected="false" aria-disabled="true">{OC.noCountry}</li>}
            {list.map((c, i) => (
              <li key={`${c.iso2}-${c.name}`} id={`${listId}-${i}`} role="option" aria-selected={c.name === value}
                className={`${i === active ? 'on' : ''}${c.common && !list[i + 1]?.common && !q ? ' oc-cpick-sep' : ''}`}
                onPointerDown={(e) => { e.preventDefault(); pick(c); }} onMouseEnter={() => setActive(i)}>
                <Flag iso2={c.iso2} /> <span>{c.name}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
