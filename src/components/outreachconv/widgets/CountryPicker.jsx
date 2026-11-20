import React, { useEffect, useMemo, useRef, useState } from 'react';
import { COUNTRY_META, countryByName, countryByDial } from '@/lib/countries';
import Flag from '@/components/shared/Flag';
import { OC } from '@/lib/outreachConvStrings';

const fold = (s) => String(s || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase();
const digits = (s) => String(s || '').replace(/\D/g, '');

/**
 * Every country with its flag (inline SVG, no external request), searchable by typing; the tenant's common entries first.
 * mode 'country': value = country name (address). mode 'dial': value = { dial, iso2 } (phone code); rows show the dial
 * code and the search also matches "+31" or "31".
 */
export default function CountryPicker({ value, onChange, common = [], disabled, id, mode = 'country', ariaLabel }) {
  const dial = mode === 'dial';
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);
  const [place, setPlace] = useState({ up: false, max: 300 });
  const box = useRef(null);
  const search = useRef(null);
  const listId = `${id || 'country'}-list`;

  const all = useMemo(() => {
    const top = common.map((c) => {
      if (dial) { const m = countryByDial(c); return { name: m?.name || c, iso2: m?.iso2 || '', dial: c, common: true }; }
      const m = countryByName(c); return { name: c, iso2: m?.iso2 || '', dial: m?.dial || '', common: true };
    });
    const seen = new Set(top.map((c) => `${c.iso2}|${dial ? c.dial : ''}`));
    const rest = COUNTRY_META.filter((c) => !seen.has(`${c.iso2}|${dial ? c.dial : ''}`))
      .map((c) => ({ name: c.name, iso2: c.iso2, dial: c.dial, common: false })).sort((a, b) => a.name.localeCompare(b.name));
    return [...top, ...rest];
  }, [common, dial]);
  const list = useMemo(() => {
    const f = fold(q).trim();
    if (!f) return all;
    const d = digits(f);
    return all.filter((c) => fold(c.name).includes(f) || c.iso2.toLowerCase() === f || (dial && d && digits(c.dial).startsWith(d)));
  }, [all, q, dial]);
  const isSelected = (c) => (dial ? c.dial === value?.dial && (!value?.iso2 || c.iso2 === value.iso2) : c.name === value);
  const selected = all.find(isSelected) || (dial
    ? (value?.dial ? { name: countryByDial(value.dial)?.name || '', iso2: value.iso2 || countryByDial(value.dial)?.iso2 || '', dial: value.dial } : null)
    : (value ? { name: value, iso2: countryByName(value)?.iso2 || '' } : null));

  // Open where there is room: the question often sits at the bottom of the screen, so the list opens upwards when
  // there is more space above, and its height follows the space available (all ~200 countries scroll inside it).
  useEffect(() => {
    if (!open) return;
    setActive(0);
    const r = box.current?.getBoundingClientRect();
    const vh = window.innerHeight || document.documentElement.clientHeight || 700;
    if (r) {
      const below = vh - r.bottom - 16;
      const above = r.top - 16;
      const up = below < 300 && above > below;
      setPlace({ up, max: Math.max(160, Math.min(380, (up ? above : below) - 70)) });
    }
    setTimeout(() => search.current?.focus({ preventScroll: true }), 0);
  }, [open]);
  useEffect(() => {
    if (!open) return undefined;
    const close = (e) => { if (box.current && !box.current.contains(e.target)) setOpen(false); };
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, [open]);

  const pick = (c) => { onChange(dial ? { dial: c.dial, iso2: c.iso2 } : c.name); setOpen(false); setQ(''); };
  const onKey = (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((i) => Math.min(i + 1, list.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((i) => Math.max(i - 1, 0)); }
    else if (e.key === 'Enter') { e.preventDefault(); if (list[active]) pick(list[active]); }
    else if (e.key === 'Escape') { e.preventDefault(); setOpen(false); }
  };
  const placeholder = dial ? OC.searchCountryCode : OC.searchCountry;

  return (
    <div className={`oc-cpick${dial ? ' oc-cpick-dial' : ''}`} ref={box}>
      <button type="button" id={id} className="oc-in oc-cpick-btn" aria-haspopup="listbox" aria-expanded={open} disabled={disabled} onClick={() => setOpen((o) => !o)}
        aria-label={ariaLabel ? `${ariaLabel}: ${selected ? (dial ? `${selected.name} ${selected.dial}` : selected.name) : ''}` : undefined}>
        {selected ? <><Flag iso2={selected.iso2} className="" title={selected.name} /> <span>{dial ? selected.dial : selected.name}</span></> : <span className="oc-small">{OC.chooseCountry}</span>}
        <span aria-hidden="true" className="oc-cpick-caret">▾</span>
      </button>
      {open && (
        <div className={`oc-cpick-pop${place.up ? ' up' : ''}`}>
          <input ref={search} className="oc-in" type="search" placeholder={placeholder} aria-label={placeholder} value={q}
            onChange={(e) => { setQ(e.target.value); setActive(0); }} onKeyDown={onKey} aria-controls={listId} aria-activedescendant={list[active] ? `${listId}-${active}` : undefined} />
          <div className="oc-small oc-cpick-count" aria-live="polite">{OC.countriesShown(list.length, all.length)}</div>
          <ul id={listId} role="listbox" className="oc-cpick-list" style={{ maxHeight: place.max }}>
            {list.length === 0 && <li className="oc-small" role="option" aria-selected="false" aria-disabled="true">{OC.noCountry}</li>}
            {list.map((c, i) => (
              <li key={`${c.iso2}-${c.name}-${c.dial}`} id={`${listId}-${i}`} role="option" aria-selected={isSelected(c)}
                className={`${i === active ? 'on' : ''}${c.common && !list[i + 1]?.common && !q ? ' oc-cpick-sep' : ''}`}
                onPointerDown={(e) => { e.preventDefault(); pick(c); }} onMouseEnter={() => setActive(i)}>
                <Flag iso2={c.iso2} className="" title={c.name} /> <span>{c.name}</span>{dial && <span className="oc-cpick-dialcode">{c.dial}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
