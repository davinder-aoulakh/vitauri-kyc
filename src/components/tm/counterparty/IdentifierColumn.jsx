import React from 'react';

/** Names, identifiers and country of one counterparty (used in the drawer and the merge comparison). */
export default function IdentifierColumn({ cp, heading }) {
  const names = [cp.display_name, ...(cp.names || []).filter((n) => n !== cp.display_name)];
  return (
    <div className="min-w-0 space-y-2 text-xs">
      {heading && <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{heading}</div>}
      <div>
        <div className="text-muted-foreground">Names</div>
        <ul>{names.map((n) => <li key={n} className="break-words">{n}</li>)}</ul>
      </div>
      <div>
        <div className="text-muted-foreground">Identifiers</div>
        {(cp.identifiers || []).length === 0 && <div>—</div>}
        <ul>{(cp.identifiers || []).map((i) => <li key={`${i.type}-${i.value}`} className="font-mono break-all">{i.value} <span className="font-sans text-muted-foreground">({i.type})</span></li>)}</ul>
      </div>
      <div><span className="text-muted-foreground">Country: </span>{cp.country || '—'} · <span className="text-muted-foreground">Kind: </span>{cp.entity_kind || 'unknown'}</div>
    </div>
  );
}