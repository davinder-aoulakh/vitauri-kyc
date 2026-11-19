import React from 'react';
import { OC } from '@/lib/outreachConvStrings';

/** "Your structure so far": the organisation, its owners (companies with their own owners), UBOs highlighted; a text alternative. */
function Node({ n }) {
  return (
    <li>
      <span className={`oc-node${n.ubo ? ' ubo' : ''}${n.type === 'company' ? ' co' : ''}`}>
        {n.name}{n.pct != null ? ` · ${n.pct}%` : ''}{n.ubo ? ` · ${OC.uboLabel} ${n.effective}%` : ''}
      </span>
      {n.owners?.length > 0 && <ul>{n.owners.map((c) => <Node key={c.name} n={c} />)}</ul>}
    </li>
  );
}
export default function StructureCard({ card, text }) {
  const tree = card?.tree || {};
  return (
    <figure className="oc-status oc-structure" aria-label={card?.title || ''}>
      <h3>{card?.title}</h3>
      <div className="oc-tree" aria-hidden="true">
        <div className="oc-node co root">{tree.entity}</div>
        <ul>{(tree.owners || []).map((n) => <Node key={n.name} n={n} />)}</ul>
        {(tree.directors || []).length > 0 && <p className="oc-small">{OC.directors}: {tree.directors.join(', ')}</p>}
      </div>
      <pre className="sr-only">{text}</pre>
      {card?.caption && <figcaption className="oc-small">{card.caption}</figcaption>}
    </figure>
  );
}
