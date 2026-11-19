// Guided conversation outreach: ultimate beneficial owners (spec 9.4/9.5, block `ubo`). Pure.
// Effective share per person = sum over all ownership paths of the product of the shares along the path,
// rounded to 0.1 percentage point. A company already on the current path is not followed again (cycle protection).
// owners: [{ type: 'person'|'company', name, pct }]; chain: { [company name]: owners[] }.

export const normName = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const round1 = (x) => Math.round(x * 10) / 10;

export function effectiveShares({ owners = [], chain = {} } = {}) {
  const byKey = {};
  const chainByKey = Object.fromEntries(Object.entries(chain || {}).map(([k, v]) => [normName(k), v]));
  const walk = (list, factor, path) => {
    for (const o of list || []) {
      const pct = Number(o.pct) || 0;
      const key = normName(o.name);
      if (!key) continue;
      if (o.type === 'company') {
        if (path.includes(key)) continue;
        walk(chainByKey[key] || [], factor * (pct / 100), [...path, key]);
      } else {
        byKey[key] = byKey[key] || { name: o.name, raw: 0 };
        byKey[key].raw += factor * pct;
      }
    }
  };
  walk(owners, 1, []);
  return Object.fromEntries(Object.values(byKey).map((p) => [p.name, round1(p.raw)]));
}

/** Names at or above the threshold, highest first. */
export function ubos(shares, threshold = 25) {
  return Object.entries(shares || {}).filter(([, v]) => v >= threshold).sort((a, b) => b[1] - a[1]).map(([n]) => n);
}

/** Tree for the structure card: the entity, its owners (companies with their own owners), directors, UBO flags. */
export function structureTree({ entity, owners = [], chain = {}, directors = [], threshold = 25 }) {
  const shares = effectiveShares({ owners, chain });
  const isUbo = new Set(ubos(shares, threshold).map(normName));
  const chainByKey = Object.fromEntries(Object.entries(chain || {}).map(([k, v]) => [normName(k), v]));
  const node = (o, path) => {
    const key = normName(o.name);
    const n = { name: o.name, type: o.type === 'company' ? 'company' : 'person', pct: o.pct === '' || o.pct == null ? null : Number(o.pct) };
    if (n.type === 'person') { n.effective = shares[o.name] ?? null; n.ubo = isUbo.has(key); }
    else if (!path.includes(key)) n.owners = (chainByKey[key] || []).map((c) => node(c, [...path, key]));
    return n;
  };
  return { entity: entity || '', owners: owners.map((o) => node(o, [])), directors: directors.map((d) => (typeof d === 'string' ? d : d.name)).filter(Boolean), threshold, shares, ubos: ubos(shares, threshold) };
}

/** Plain-text version of the card (screen readers, audit, transcript). */
export function structureText(tree) {
  const lines = [];
  const walk = (list, depth) => list.forEach((n) => {
    lines.push(`${'  '.repeat(depth)}${n.name}${n.pct != null ? ` ${n.pct}%` : ''}${n.ubo ? ` (UBO ${n.effective}%)` : ''}`);
    if (n.owners) walk(n.owners, depth + 1);
  });
  walk(tree.owners || [], 0);
  if ((tree.directors || []).length) lines.push(`Directors: ${tree.directors.join(', ')}`);
  return lines.join('\n');
}
