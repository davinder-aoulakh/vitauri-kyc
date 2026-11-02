import React, { useEffect, useState } from 'react';
import { cn } from '@/lib/utils';

// SVG flags (country-flag-icons) — emoji flags don't render on Windows. The flag set is loaded once, on first use,
// as a separate chunk so it doesn't weigh on pages without a country field.
let flagsPromise = null;
let flags = null;
const loadFlags = () => {
  if (!flagsPromise) flagsPromise = import('country-flag-icons/string/3x2').then((m) => { flags = m; return m; }).catch(() => null);
  return flagsPromise;
};

export default function Flag({ iso2, className, title }) {
  const [, setReady] = useState(!!flags);
  useEffect(() => { if (!flags) loadFlags().then(() => setReady(true)); }, []);
  const code = String(iso2 || '').toUpperCase();
  const svg = flags && /^[A-Z]{2}$/.test(code) ? flags[code] : null;
  return (
    <span className={cn('inline-block w-5 h-[14px] shrink-0 overflow-hidden rounded-[2px] bg-muted ring-1 ring-black/5 align-middle', className)} title={title}>
      {svg && <img alt="" src={`data:image/svg+xml;utf8,${encodeURIComponent(svg)}`} className="w-full h-full object-cover" />}
    </span>
  );
}
