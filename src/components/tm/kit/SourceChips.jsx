import React from 'react';
import { Link } from 'react-router-dom';
import { useRefLabels, fallbackLabel, parseRef } from '@/lib/refs';
import CounterpartyLink from '@/components/tm/counterparty/CounterpartyLink';
import { cn } from '@/lib/utils';

const CHIP = 'inline-flex max-w-[260px] items-center truncate rounded border border-border bg-muted/60 px-1.5 py-0.5 text-[10px] text-muted-foreground';

/** Citations as readable, clickable chips ("Transaction 09-09 · 2,650 XCG · J. Rodriguez"). Never raw ids. */
export default function SourceChips({ refs, className, max = 12 }) {
  const list = (refs || []).filter(Boolean);
  const { data } = useRefLabels(list);
  if (!list.length) return null;
  const shown = list.slice(0, max);
  return (
    <span className={cn('inline-flex flex-wrap items-center gap-1', className)}>
      {shown.map((ref) => {
        const { kind, id } = parseRef(ref);
        const info = data?.[ref] || { label: fallbackLabel(ref), to: null };
        if (kind === 'counterparty') {
          return <CounterpartyLink key={ref} id={id} className={CHIP}>{info.label}</CounterpartyLink>;
        }
        return info.to
          ? <Link key={ref} to={info.to} title={info.label} className={cn(CHIP, 'text-primary hover:underline')} onClick={(e) => e.stopPropagation()}>{info.label}</Link>
          : <span key={ref} title={info.label} className={CHIP}>{info.label}</span>;
      })}
      {list.length > max && <span className="text-[10px] text-muted-foreground">+{list.length - max} more</span>}
    </span>
  );
}
