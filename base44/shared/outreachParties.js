// Guided conversation outreach: the people and companies named in an ORG conversation (directors, representatives, owners,
// UBOs) merged into one list of parties with their roles, and the OutreachPartyRelation rows. Pure.
import { normName } from './outreachUbo.js';

export const slug = (s) => normName(s).replace(/\s+/g, '_').slice(0, 40) || 'person';

/**
 * datapoints: the engine's datapoints (directors, authreps, owners, chain_*, ubos). Returns
 * [{ key, name, kind: 'person'|'company', roles: [...], pct, effective, authority, sources }].
 */
export function partiesOf(dp = {}) {
  const map = new Map();
  const add = (name, kind, role, extra = {}) => {
    const key = normName(name);
    if (!key) return;
    const p = map.get(key) || { key, name, kind, roles: [], sources: [] };
    if (role && !p.roles.includes(role)) p.roles.push(role);
    for (const [k, v] of Object.entries(extra)) if (v !== undefined && v !== null && v !== '') p[k] = v;
    map.set(key, p);
  };
  for (const d of asArr(dp.directors?.value)) add(d.name, 'person', 'Director', { authority: d.authority || undefined, sources: undefined });
  for (const r of asArr(dp.authreps?.value)) add(r.name, 'person', 'Authorized Signatory', { authority: r.authority || undefined });
  for (const o of asArr(dp.owners?.value)) add(o.name, o.type === 'company' ? 'company' : 'person', 'Shareholder', { pct: o.pct });
  for (const [k, v] of Object.entries(dp)) if (k.startsWith('chain_')) for (const o of asArr(v?.value?.owners)) add(o.name, o.type === 'company' ? 'company' : 'person', 'Shareholder');
  const shares = dp.ubos?.value?.shares || {};
  for (const n of asArr(dp.ubos?.value?.ubos)) add(n, 'person', 'UBO', { effective: shares[n] });
  for (const n of asArr(dp.ubos?.value?.directors_as_ubo)) add(n, 'person', 'UBO');
  return [...map.values()].map((p) => { delete p.sources; return p; });
}
const asArr = (v) => (Array.isArray(v) ? v : []);

/** OutreachPartyRelation rows (without tenant/conversation ids): who owns whom, who directs or represents the entity. */
export function relationRows({ entity, dp = {} }) {
  const rows = [];
  const ent = entity || 'entity';
  for (const d of asArr(dp.directors?.value)) rows.push({ from_name: d.name, from_kind: 'person', to: ent, relation: 'director', authority: d.authority || null, source: dp.directors?.source || 'rep' });
  for (const r of asArr(dp.authreps?.value)) rows.push({ from_name: r.name, from_kind: 'person', to: ent, relation: 'authorised_representative', authority: r.authority || null, authority_note: r.note || null, source: 'rep' });
  for (const o of asArr(dp.owners?.value)) rows.push({ from_name: o.name, from_kind: o.type === 'company' ? 'company' : 'person', to: ent, relation: 'owner', pct: Number(o.pct) || null, source: 'rep' });
  for (const [k, v] of Object.entries(dp)) if (k.startsWith('chain_')) for (const o of asArr(v?.value?.owners)) rows.push({ from_name: o.name, from_kind: o.type === 'company' ? 'company' : 'person', to: v.value.company, relation: 'owner', pct: Number(o.pct) || null, source: 'rep' });
  const shares = dp.ubos?.value?.shares || {};
  for (const n of asArr(dp.ubos?.value?.ubos)) rows.push({ from_name: n, from_kind: 'person', to: ent, relation: 'ubo', effective_pct: shares[n] ?? null, source: 'calc' });
  return rows;
}


/**
 * The tracker of block `invites` (spec 9.6): directors, UBOs and authorised representatives, one row per person.
 * repName: the person the client declared to be (null for "None of these"). Owners below the UBO threshold who are
 * not a director or representative need no check (note_threshold).
 */
export function inviteParties(dp = {}, { repName = null } = {}) {
  const people = partiesOf(dp).filter((p) => p.kind === 'person' && p.roles.some((r) => ['Director', 'UBO', 'Authorized Signatory'].includes(r)));
  const repKey = repName ? normName(repName) : null;
  const rows = people.map((p) => ({
    key: p.key, name: p.name, roles: p.roles.filter((r) => r !== 'Shareholder'), role_text: roleText(p.roles),
    status: p.key === repKey ? 'Your check comes last' : 'To invite', is_rep: p.key === repKey,
  }));
  const below = partiesOf(dp).filter((p) => p.kind === 'person' && p.roles.length === 1 && p.roles[0] === 'Shareholder').map((p) => p.name);
  return { rows, belowThreshold: below };
}

/** "Director", "UBO", "authorised representative" — for "{company} has asked you … as {role_text}". */
export function roleText(roles = []) {
  const map = { Director: 'Director', UBO: 'ultimate beneficial owner', 'Authorized Signatory': 'authorised representative', Shareholder: 'shareholder' };
  const list = roles.filter((r) => map[r]).map((r) => map[r]);
  return list.length ? list.join(' and ') : 'related party';
}
